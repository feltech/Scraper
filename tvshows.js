console.log("Entry");
var Casper = require("casper"),
	_ = require("lodash"),
	parser = require("episode-parser"),
	fs = require("fs"),
	options = {
		verbose: true,
		logLevel: "warning",
		waitTimeout: 60000,
		onError: function () {
			this.echo("ERROR " + arguments);
		}
	},
	casper = Casper.create(options),
	numPages = parseInt(casper.cli.args[0] || "3", 10),
	logger,
	shows,
	scrapeShows,
	noop = function () {};


console.log("Begin");


function reportErrors(fn) {
	return function () {
		try {
			return fn.apply(this, arguments);
		} catch (e) {
			console.log(e);
			throw e;
		}
	}
}


function Scraped(casper) {
	this.casper = casper;
	this.step = 0;
}


Scraped.prototype.say = function (text) {
	this.casper.then(function () {
		this.echo("--- " + text);
	});
}


function TVShow(name, casper) {
	Scraped.call(this, casper);
	this.name = name;
	this.imdbURL = "";
	this.year = "";
	this.genre = "";
	this.rating = "";
	this.duration = 0;
}

TVShow.prototype = Object.create(Scraped.prototype);
TVShow.prototype.constructor = TVShow;


TVShow.prototype.imdbLink = reportErrors(function () {
	var show = this;

	this.say("searching for IMDB link for '" + this.name + "'");

	this.casper.thenOpen(
		"http://www.imdb.com/search/title?title=" + this.name + "&title_type=tv_series"
	);

	this.say("waiting for search page to show");

	this.casper.waitForSelector("div.lister");

	this.say("extracting IMDB link");

	this.casper.then(reportErrors(function () {
		var casper = this,
			url = casper.evaluate(function () {
				if ($("h3.lister-item-header > a").length === 0) {
					return null;
				}

				return $("h3.lister-item-header > a").first().prop("href");
			});

		if (!url) {
			casper.echo("IMDB link not found");
		} else {
			show.imdbURL = url.split("?")[0];
			casper.echo("IMDB link for '" + show.name + "' is " + show.imdbURL);
		}
	}));
});


TVShow.prototype.imdbInfo = reportErrors(function () {
	var show = this;

	this.say("opening IMDB page for '" + this.name + "' from " + this.imdbURL);

	this.casper.thenOpen(this.imdbURL);

	this.say("awaiting IMDB page load");

	this.casper.waitForSelector("[itemprop='name']");

	this.say("parsing IMDB info");

	this.casper.then(reportErrors(function () {
		var imdbInfo;
		imdbInfo = this.evaluate(function () {
			function text(selector) {
				return $(selector).first().contents().not($(selector).children()).text().trim();
			}

			function num(selector) {
				return parseFloat(text(selector), 10);
			}

			return {
				rating: num("[itemprop='ratingValue']"),
				duration: text("time[itemprop='duration']"),
				name: text("h1[itemprop='name']"),
				year: $("div.subtext > a").last().html()
					.replace(/[A-Z\(\)\s]/gi, "").replace(/\D/g, "-"),
				description: $("[itemprop='description'] > p").first().contents().not(
						$("[itemprop='description'] > p > em.nobr").last()
					).text().trim(),
				genre: $("div.titleBar [itemprop='genre']").map(function () {
					return $(this).text().trim();
				}).get().join(", ")
			};
		});
		
		["name", "description"].forEach(function (attr) {
			if (imdbInfo[attr])
				imdbInfo[attr] = _.escape(imdbInfo[attr]);
		});
		
//		this.echo(JSON.stringify(imdbInfo));
		_.extend(show, imdbInfo);
	}));
});


TVShow.prototype.html = reportErrors(function () {
	return "<tr><th>" + this.name + " (" + this.year + ")" + "</th><th>" +
		(this.rating && this.rating.toFixed(1) || "???") + "</th><th>" + this.genre +
		"</th><th>" + this.duration + "</th>" +
		"</tr><tr><td colspan=4>" + this.description + "<br/>" +
		"<a href='" + this.imdbURL + "'>" + this.imdbURL + "</a></td></tr>\n";
});


casper.start("about:blank");

logger = new Scraped(casper);

logger.say("logging enabled");

scrapeShows = reportErrors(function (casper) {
	var pageNum = 0,
		i,
		baseURL = "https://eztv.ag/",
		url = baseURL,
		titles = [];

	logger.say("looping over eztv pages");

	for (pageNum = 1; pageNum <= numPages; pageNum++) {
		logger.say("opening eztv page: " + url);

		casper.thenOpen(url);

		logger.say("waiting for page load");

		casper.waitForSelector("a.epinfo");

		logger.say("extracting titles");

		casper.then(reportErrors(function () {
			var pageTitles = this.evaluate(function () {
				return $("a.epinfo").map(function () {
					return $(this).text().trim();
				}).get();
			});

			pageTitles = pageTitles.map(function (title) {
				return parser(title);
			}).filter(function (title) {
				return title && title.show;
			}).map(function (title) {
				return title.show;
			});

			[].push.apply(titles, pageTitles);
//			titles = [pageTitles[0]];
		}));

		url = baseURL + "page_" + pageNum;
	}

	casper.then(reportErrors(function () {
		var casper = this;

		titles = _.uniq(titles);

		shows = titles.map(function (title) {
			return new TVShow(title, casper);
		});

		this.echo("finding imdb links for " + shows.length + " shows");

		shows.forEach(function (show) {
			show.imdbLink();
		});
	}));

	casper.then(reportErrors(function () {
		this.echo("filtering shows with no imdb link");

		shows = shows.filter(function (show) {
			return show.imdbURL;
		});

		this.echo("finding imdb info for remaining " + shows.length + " shows");

		shows.forEach(function (show) {
			show.imdbInfo();
		});
	}));

	casper.then(reportErrors(function () {
		var casper = this,
			tmpl,
			html = "";

		this.echo("filtering shows with no imdb info");

		shows = shows.filter(function (show) {
			return show.rating;
		});

		this.echo("constructing html for remaining " + shows.length + " shows");

		html += "<thead><tr><th>Title</th><th>Rating</th><th>Genre</th><th>Duration</th></tr>" +
				"</thead><tbody>\n";

		this.echo("getting table rows");

		shows.forEach(function (show) {
			html += show.html();
		});
		html += "</tbody>";

		this.echo("reading ejs source");

		tmpl = fs.read("body.ejs");

		this.echo("creating template from ejs");

		tmpl = _.template(tmpl);

		this.echo("generating html");

		html = tmpl({
			page: "tvshows", headerTitle: "Top TV Shows",
			headerSubtitle: "overview of popular shows airing in the last couple of days",
			tableContent: html, listSrcURL: "https://eztv.ag", listSrcName: "EZTV"
		});

		this.echo("writing html");

		fs.write("tvshows.html", html, { mode: "w", charset: "utf-8" });
	}));
});

scrapeShows(casper);

casper.run();
