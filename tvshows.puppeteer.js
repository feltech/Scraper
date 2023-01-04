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
log.setLevel("info");

let _eztvURL = "https://eztv.re/";

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
		for (let show of shows) {
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
				try {
					await this.imdbLink(show);
				} catch (e) {
					log.warn(this.page.content());
				}
			}
		}

		log.debug("filtering shows with no imdb link");

		unknownShows = shows.filter(function (show) {
			return !show.url;
		});

		shows = shows.filter(function (show) {
			return show.url;
		});

		log.info(shows.length + " shows remaining after filtering for imdb link");
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
			return !show.description;
		}));

		shows = shows.filter(function (show) {
			return show.description;
		});

		log.info(shows.length + " shows remaining after filtering for description");

		// Should already be de-duped when scraping EZTV, but some slip the net.
		shows = _.uniqBy(shows, 'url');

		log.info(shows.length + " shows remaining after de-duplication");

		if (shows.length === 0) {
			log.info("Zero titles left after filtering");
			return;
		}

		log.debug("writing show info to disk cache");

		for (let show of shows) {
			showsByName[_.snakeCase(show.initialName)] = _.pick(show, [
				"season", "episode", "url", "year", "genre", "rating", "duration",
				"description", "name"]);
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
				// headless: false,
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox'
				]
			});
			// Open new tab in browser.
			this.page = await this.browser.newPage();
			await this.page.setUserAgent(
				'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)' +
				' Chrome/78.0.3904.108 Safari/537.36');
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
		log.debug("Waiting for selector on " + "http://www.imdb.com/find?s=tt&ttype=tv&q=" +
			encodeURIComponent(title.name));
		await this.page.waitForSelector(".ipc-metadata-list");

		title.url = await this.page.evaluate(() => {
			return document.querySelector("a.ipc-metadata-list-summary-item__t").href;
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

		try {
			await this.page.waitForSelector(
				"[data-testid='hero-title-block__title'], div.title_wrapper > h1");

			log.info("Parsing IMDB info for '" + show.name + "' from " + this.page.url());
			imdbInfo = await this.page.evaluate(function () {

				function $$(selector) {
					return Array.from(document.querySelectorAll(selector));
				}

				function $q(selector) {
					return document.querySelector(selector);
				}

				function $children(selector) {
					try {
						return Array.from(document.querySelector(selector).children);
					} catch (e) {
						console.error("Failed to query children of " + selector);
						return [];
					}
				}

				function $texts(els) {
					return els.map((el) => el.textContent.trim()).join(", ");
				}

				return {
					duration: $texts($$(
						'li[data-testid="title-techspec_runtime"] > div'
					)),

					rating: $children(
						"[data-testid='hero-rating-bar__aggregate-rating__score']"
					).map((el) => parseFloat(el.textContent.trim(), 10))[0],

					name: $q("[data-testid='hero-title-block__title']").textContent,

					year: $texts($$(
						'ul[data-testid="hero-title-block__metadata"] > li:nth-child(2) > a')),

					description: $q("[data-testid='plot-xl']").textContent.trim(),

					genre: $texts($$("[data-testid='genres'] span"))
				};
			});
		} catch (e) {
			log.error(`Failed to parse IMDB page for "${show.initialName}": ${show.url} ... `, e);
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
		try {

			return "<tbody data-seq='" + seq + "' data-imdb='" + show.url + "' data-rating='" + (show.rating || 0) +
				"' data-episode='S" + _.padStart(show.season, 2, "0") +
				"E" + _.padStart(show.episode, 2, "0") + "'><tr><th>" +
				show.name + " (" + show.year + ")" + "</th><th>" +
				(show.rating && show.rating.toFixed(1) || "???") + "</th><th>" + show.genre +
				"</th><th>" + show.duration + "</th>" +
				"</tr><tr><td colspan=4>" + show.description + "<br/>" +
				"<a href='" + show.url + "'>" + show.url + "</a></td></tr></tbody>\n";
		} catch (e) {
			log.error("Failed to generate HTML for show:\n" + JSON.stringify(show));
			throw e;
		}
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
