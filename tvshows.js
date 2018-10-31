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
			this.echo("ERROR " + JSON.stringify(arguments.toArray()));
			this.capture("/tmp/tvshows.ERROR.png");
		}
	},
	casper = Casper.create(options),
	numPages = parseInt(casper.cli.args[0] || "5", 10),
	logger,
	shows,
	scrapeShows,
	noop = function () {};


casper.echo("Starting at " + new Date());

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


function TVShow(episode, casper) {
	Scraped.call(this, casper);
	this.name = episode.show;
	this.season = episode.season;
	this.episode = episode.episode;
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

	this.casper.waitForSelector("h1.header");

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

	this.casper.waitForSelector("div.title_wrapper");

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

        this.echo(_.truncate(JSON.stringify(imdbInfo), {length: 1000}));

		["name", "description"].forEach(function (attr) {
			if (imdbInfo[attr])
				imdbInfo[attr] = _.escape(imdbInfo[attr]);
		});

		_.each(imdbInfo, function (value, key) {
			if (!value) {
				this.echo(key + " has no value: '" + value + "'");
			}
		}.bind(this));

//		this.echo(JSON.stringify(imdbInfo));
		_.extend(show, imdbInfo);
	}));
});


TVShow.prototype.html = reportErrors(function () {
	return "<tr data-imdb='" + this.imdbURL +
		"' data-episode='S" + _.padStart(this.season, 2, "0") +
		"E" + _.padStart(this.episode, 2, "0") + "'><th>" +
		this.name + " (" + this.year + ")" + "</th><th>" +
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
			});

			[].push.apply(titles, pageTitles);
//			titles = [pageTitles[0]];
		}));

		url = baseURL + "page_" + pageNum;
	}

	casper.then(reportErrors(function () {
		var casper = this;

		titles = _.uniqBy(titles, 'show');

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
			page: "tvshows", icon: "blackboard", headerTitle: "TV Shows",
			headerSubtitle: "overview of popular shows airing in the last couple of days",
			tableContent: html, listSrcURL: "https://eztv.ag", listSrcName: "EZTV"
		});

		this.echo("writing html");

		fs.write("tvshows.html", html, { mode: "w", charset: "utf-8" });
	}));
});

scrapeShows(casper);

casper.run();
