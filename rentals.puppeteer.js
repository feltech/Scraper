const puppeteer = require("puppeteer");
const _ = require("lodash");
const moment = require("moment");
const fs = require("fs");
const ArgumentParser = require("argparse").ArgumentParser;

// create a custom timestamp format for log statements
const SimpleNodeLogger = require('simple-node-logger');
const log = SimpleNodeLogger.createSimpleLogger({
	timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
});
log.setLevel("debug");


class Scraper {
	constructor(numWeeks, minRating) {
		this._numWeeks = numWeeks;
		this._minRating = minRating;
	}

	async execute() {
		log.info(
			`Extracting films charted for max ${this._numWeeks} week(s) with minimum rating` +
			` ${this._minRating}`
		);

		await this.initBrowser();

		log.info("Fetching titles from charts");
		let titles = await this.charts();

		// log.debug(JSON.stringify(titles));

		log.info("Filtering titles that charted too long ago");
		titles = _(titles).filter((title) => {
			if (!title.name) {
				log.warn(`Title with no name: ${JSON.stringify(title)}`);
				return false;
			}
			const isRecentEnough = title.weeks <= this._numWeeks;
			if (!isRecentEnough) {
				log.debug(
					`${title.name} at ${title.weeks} weeks does meet max ${this._numWeeks} weeks` +
					` since charted`);
			}
			return isRecentEnough;
		}).sortBy('weeks').value();

		log.info("Fetching IMDB links for titles");
		for (let title of titles) {
			await this.imdbLink(title);
		}

		log.info("Filtering titles with no IMDB link");
		titles = titles.filter((title) => {
			const hasLink = !!title.url;
			if (!hasLink) {
				log.debug(title.name + " has no IMDB link");
			}
			return hasLink;
		});

		titles = _.uniqBy(titles, "url");

		log.info("Fetching IMDB info for titles");
		for (let title of titles) {
			await this.imdb(title);
		}

		log.info("Filtering titles by rating");
		titles = titles.filter((title) => {
			const hasMinRating = title.rating >= this._minRating;
			if (!hasMinRating) {
				log.debug(`${title.name} at ${title.rating} rating does not meet min` +
					` ${this._minRating} rating requirement`);
			}
			return hasMinRating;
		});

		if (titles.length === 0) {
			log.info("Zero titles left after filtering");
			return;
		}

		log.info("Constructing html for remaining " + titles.length + " shows");

		let html = "<thead><tr>" +
			"<th>Title</th><th>Rating</th><th>Weeks</th><th>Genre</th></tr></thead><tbody>";

		titles.forEach(function (title, idx) {
			html += "<tbody data-seq='" + idx + "' data-rating='" + title.rating + "' data-imdb='" +
				title.url + "'><tr><th>" +
				title.name + " (" + title.year + ")" + "</th><th>" +
				(title.rating && title.rating.toFixed(1) || "???") +
				"</th><th>" + title.weeks + "</th><th>" + title.genre + "</th></tr>" +
				"<tr><td colspan=4>" + title.description + "<br/>" +
				"<a href='" + title.url + "'>" + title.url + "</a></td></tr></tbody>\n";
		});

		html += "</tbody>";

		log.debug("Reading ejs source");

		const tmplStr = fs.readFileSync("body.ejs");

		log.debug("Creating template from ejs");

		const tmpl = _.template(tmplStr);

		log.debug("Generating html");

		html = tmpl({
			page: "movierentals", icon: "film", headerTitle: "Movie Rentals",
			headerSubtitle: "overview of movie rentals rated greater than " + this._minRating.toFixed(1) +
				" from the last " + this._numWeeks + " weeks",
			tableContent: html, listSrcURL: "http://www.officialcharts.com",
			listSrcName: "officialcharts.com",
			lastUpdatedFile: "moviesupdated.json"
		});

		log.debug("Writing html");

		fs.writeFileSync("movierentals.html", html);
	}

	/**
	 * Fire up the Chrome headless browser and open a blank page.
	 */
	async initBrowser() {
		// Only one request at once...
		if (this.browser)
			throw new Error("Attempting to open more than one browser session");
		try {
			// Open browser.
			this.browser = await puppeteer.launch({
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox'
				]
			});
			// Open new tab in browser.
			this.page = await this.browser.newPage();
			this.page.setViewport({width: 1280, height: 720});
			// Log site console logs.
			this.page.on('console', (message) => {
				const type = message.type().substr(0, 3).toUpperCase();
				log.debug(`---- Page: ${type} ${message.text()} ${message.location().url || ""}`);
			});
		} catch (e) {
			await this.logError(e);
		}
	}


	async charts() {
		log.info("Opening officialcharts.com");
		await this.page.goto(
			"http://www.officialcharts.com/charts/film-on-video-chart/",
			{waitUntil: "domcontentloaded"});

		log.info("Extracting titles");
		let titles = await this.page.evaluate(() => {
			return $("table.chart-positions tr").not("[class]").map(function () {
				return {
					weeks: parseInt($("td", this).last().prev().text().trim(), 10),
					name: $("div.title", this).text().trim()
				};
			}).toArray();
		});
		return titles;
	}

	async imdbLink(title) {
		log.info("Search IMDB link for " + title.name);
		await this.page.goto(
			"http://www.imdb.com/find?s=tt&ttype=ft&q=" + encodeURIComponent(title.name)
		);
		await this.page.waitForSelector("#main");

		title.url = await this.page.evaluate(() => {
			if ($("a[name='tt']").closest(".findSection").find("td.result_text > a").length === 0) {
				return null;
			}

			return $("a[name='tt']").closest(".findSection").find(
				"td.result_text > a").first().prop("href");
		});

		if (!title.url) {
			log.info("IMDB link not found for '" + title.name + "'");
		} else {
			title.url = title.url.split("?")[0];
			log.info("IMDB link for '" + title.name + "' is " + title.url);
		}
	}

	async imdb(title) {
		log.info("Opening IMDB info for '" + title.name + "' from " + title.url);

		await this.page.goto(title.url);
		await this.page.waitForSelector("div.title_wrapper > h1");

		log.info("Parsing IMDB info for '" + title.name + "' from " + this.page.url());

		let imdbInfo = await this.page.evaluate(function () {
			function text(selector) {
				return $(selector).contents().not($(selector).children()).text().trim();
			}

			function num(selector) {
				return parseFloat(text(selector), 10);
			}

			return {
				rating: num("div.ratingValue > strong > span"),
				name: text("div.title_wrapper > h1"),
				year: /[0-9]{4}/.exec(
					$("#titleDetails > div > h4:contains('Release Date')").parent().text()
				)[0],
				description: $("#titleStoryLine > div > p > span").text().trim(),
				genre: $("#titleStoryLine > div > h4:contains('Genres')").parent().find("a").map(
					function () {
						return $(this).text().trim();
					}
				).toArray().join(", ")
			};
		});

		log.debug(imdbInfo);

		_.extend(title, imdbInfo);
	}

	/**
	 * Log the error.
	 *
	 * @param {Error} e exception to log
	 */
	async logError(e) {
		log.error("Unexpected exception", e);
	}
}

if (require.main === module) {
	const parser = new ArgumentParser({
		version: '1.0.0',
		addHelp: true,
		description: "Scrape rentals from officialcharts.com, filter by week/rating, furnish with" +
			" info from IMDB, then write html of results"
	});
	parser.addArgument("--weeks", {
		help: "Max weeks of rentals to scrape",
		type: "int",
		defaultValue: 8
	});
	parser.addArgument("--rating", {
		help: "Min rating of movie on IMDB",
		type: "float",
		defaultValue: 6.0
	});
	const [args, remainder] = parser.parseKnownArgs(process.argv);
	// log.debug(JSON.stringify(process.argv));
	// log.debug(JSON.stringify(args));
	const scraper = new Scraper(args.weeks, args.rating);
	scraper.execute().then(() => {
		log.info("Completed successfully");
		// Allow time for logger to flush, then exit.
		process.nextTick(() => process.exit());
	}, (err) => {
		log.error("Unhandled exception", err);
		// Allow time for logger to flush, then exit with error code.
		process.nextTick(() => process.exit(1));
	});
}
