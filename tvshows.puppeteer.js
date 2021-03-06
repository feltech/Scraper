
const puppeteer = require("puppeteer");
const _ = require("lodash");
const fs = require("fs");
const ArgumentParser = require("argparse").ArgumentParser;
const parser = require("episode-parser");

// create a custom timestamp format for log statements
const SimpleNodeLogger = require('simple-node-logger');
const log = SimpleNodeLogger.createSimpleLogger({
	timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
});
log.setLevel("debug");

let _eztvURL = "https://eztv.io/";

class Scraper {

	constructor(numPages) {
		this._numPages = numPages;
	}

	async execute() {
		let unknownShows = [],
			showsCache = {},
			showsByName = {};
		log.info(`Extracting ${this._numPages} pages of TV shows from EZTV`);

		await this.initBrowser();

		log.info("Extracting titles from EZTV");
		let shows = await this.eztv();

		log.debug("loading shows from cache");
		
		try {
			showsCache = JSON.parse(fs.readFileSync("shows.json"));
		} catch (e) {
			log.warn("Cache not found: " + e);
		}
		for (let show of shows){
			let showCache = showsCache[_.snakeCase(show.initialName)];
			if (showCache) {
				_.extend(show, showCache);
			}
		}

		log.info("Finding imdb links for " + shows.length + " shows");

		for (let show of shows) {
			if (show.url) {
				log.debug("(Cached) IMDB link for '" + show.initialName + "' is " + show.url);
			} else {
				await this.imdbLink(show);
			}
		}

		log.debug("filtering shows with no imdb link");

		unknownShows = shows.filter(function (show) {
			return !show.url;
		});

		shows = shows.filter(function (show) {
			return show.url;
		});

		log.debug("finding imdb info for remaining " + shows.length + " shows");

		for (let show of shows) {
			if (show.rating) {
				log.debug("(Cached) IMDB info for '" + show.initialName);
			} else {
				await this.imdb(show);
			}
		}
		
		log.debug("filtering shows with no imdb info");

		unknownShows.push.apply(unknownShows, shows.filter(function (show) {
			return !show.rating;
		}));

		shows = shows.filter(function (show) {
			return show.rating;
		});

		// Should already be de-duped when scraping EZTV, but some slip the net.
		shows = _.uniqBy(shows, 'url');

		if (shows.length === 0) {
			log.info("Zero titles left after filtering");
			return;
		}

		log.debug("writing show info to disk cache");

		for (let show of shows) {
			showsByName[_.snakeCase(show.initialName)] = _.pick(show, [
				"season", "episode", "url", "year", "genre", "rating", "duration", 
				"description",  "name"]);
		}
		_.assign(showsCache, showsByName);

		try {
			fs.writeFileSync("shows.json", JSON.stringify(showsCache));
		} catch (e) {
			log.warn("Failed to write cache: " + e);
		}

		log.info("Constructing html for " + shows.length + " shows");

		let html = "<thead><tr><th>Title</th><th>Rating</th><th>Genre</th><th>Duration</th></tr>" +
			"</thead><tbody>\n";

		shows.forEach((show, idx) => {
			html += this.showHTML(show, idx);
		});
		html += "</tbody>";

		log.debug("Reading ejs source");

		const tmplStr = fs.readFileSync("body.ejs");

		log.debug("Creating template from ejs");

		const tmpl = _.template(tmplStr);

		log.debug("Generating html");

		html = tmpl({
			page: "tvshows", icon: "blackboard", headerTitle: "TV Shows",
			headerSubtitle: "overview of popular shows airing in the last couple of days",
			tableContent: html, listSrcURL: "https://eztv.ag", listSrcName: "EZTV",
			lastUpdatedFile: "tvupdated.json"
		});

		log.debug("Writing html");

		fs.writeFileSync("tvshows.html", html);

		log.warn("Unknown shows:\n" + _.uniq(unknownShows.map(function (show) {
			return "   " + show.initialName;
		})).sort().join("\n"));
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
			await this.page.setViewport({width: 1280, height: 720});
			// Log site console logs.
			this.page.on('console', (message) => {
				const type = message.type().substr(0, 3).toUpperCase();
				log.debug(`---- Page: ${type} ${message.text()} ${message.location().url || ""}`);
			});
		} catch (e) {
			await this.logError(e);
		}
	}

	async eztv() {
		let url = _eztvURL,
			titles = [],
			pageTitles;

		log.info("Extracting titles");
		for (let pageNum = 0; pageNum <= this._numPages; pageNum++) {
			log.debug("opening eztv page: " + url);

			await this.page.goto(url, {waitUntil: "domcontentloaded"});

			log.debug("extracting titles");

			pageTitles = await this.page.evaluate(function () {
				return $("a.epinfo").map(function () {
					return $(this).text().trim();
				}).get();
			});

			pageTitles = pageTitles.map(function (title) {
				return parser(title);
			}).filter(function (title) {
				return title && title.show;
			});

			[].push.apply(titles, pageTitles);

			url = _eztvURL + "page_" + pageNum;
		}

		titles = _.uniqBy(titles, 'show');

		titles = titles.map(function ({show, season, episode}) {
			return {initialName: show, name: show, season, episode};
		});

		return titles;
	}
	

	async imdbLink(title) {
		log.info("Search IMDB link for " + title.name);
		await this.page.goto(
			"http://www.imdb.com/find?s=tt&ttype=tv&q=" + encodeURIComponent(title.name)
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
			log.warn("IMDB link not found for '" + title.name + "'");
		} else {
			title.url = title.url.split("?")[0];
			log.info("IMDB link for '" + title.name + "' is " + title.url);
		}
	}

	async imdb(show) {
		let imdbInfo;
		log.info("Opening IMDB info for '" + show.name + "' from " + show.url);

		await this.page.goto(show.url);
		await this.page.waitForSelector("div.title_wrapper > h1");

		log.info("Parsing IMDB info for '" + show.name + "' from " + this.page.url());

		try {
			imdbInfo = await this.page.evaluate(function () {
				function text(selector) {
					return $(selector).first().contents().not($(selector).children()).text().trim();
				}

				function num(selector) {
					return parseFloat(text(selector), 10);
				}

				return {
					duration: $("#titleDetails > div > h4:contains('Runtime')").parent()
						.find("time").text().trim(),
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
		} catch (e) {
			log.error(`Failed to parse IMDB page for "${show.initialName}": ${show.url}`);
			return;
		}
		log.debug(_.truncate(JSON.stringify(imdbInfo), {length: 1000}));

		["name", "description"].forEach((attr) => {
			if (imdbInfo[attr])
				imdbInfo[attr] = _.escape(imdbInfo[attr]);
		});

		_.each(imdbInfo, (value, key) => {
			if (!value) {
				log.warn(key + " has no value: '" + value + "'");
			}
		});

		_.extend(show, imdbInfo);
	}
	
	showHTML(show, seq) {
		return "<tbody data-seq='" + seq + "' data-imdb='" + show.url + "' data-rating='" + show.rating +
			"' data-episode='S" + _.padStart(show.season, 2, "0") +
			"E" + _.padStart(show.episode, 2, "0") + "'><tr><th>" +
			show.name + " (" + show.year + ")" + "</th><th>" +
			(show.rating && show.rating.toFixed(1) || "???") + "</th><th>" + show.genre +
			"</th><th>" + show.duration + "</th>" +
			"</tr><tr><td colspan=4>" + show.description + "<br/>" +
			"<a href='" + show.url + "'>" + show.url + "</a></td></tr></tbody>\n";
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
		description: "Scrape TV shows from EZTV, furnish with" +
			" info from IMDB, then write html of results"
	});
	parser.addArgument("--pages", {
		help: "Max pages of EZTV scrape",
		type: "int",
		defaultValue: 15
	});
	const [args, remainder] = parser.parseKnownArgs(process.argv);
	// log.debug(JSON.stringify(process.argv));
	// log.debug(JSON.stringify(args));
	const scraper = new Scraper(args.pages);
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
