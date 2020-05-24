/*global angular,CasperError,$*/

var step = 0,
	Casper = require("casper"),
	_ = require('lodash'),
	fs = require("fs"),
	options = {
		verbose: true,
		logLevel: "warning",
		waitTimeout: 60000,
		onError: function () {
			this.echo("ERROR " + arguments);
			this.capture("/tmp/" + (step++) + ".ERROR.png");
		}
	},
	casper = Casper.create(options),
	numWeeks = parseInt(casper.cli.args[0] || "8", 10),
	minRating = parseFloat(casper.cli.args[1] || "6.0", 10),
	noop = function () {},
	titles;


casper.echo("Starting at " + new Date());
casper.start("about:blank");


function charts() {
	var page = casper;//Casper.create(options);

	page.thenOpen("http://www.officialcharts.com/charts/film-on-video-chart/");

	page.then(function () {
		titles = this.evaluate(function () {
			return $("table.chart-positions tr").not("[class]").map(function () {
				return {
					weeks: parseInt($("td", this).last().prev().text().trim(), 10),
					name: $("div.title", this).text().trim()
				};
			}).toArray();
		});

		titles = _(titles).filter(function (title) {
			return title.weeks <= numWeeks;
		}).sortBy('weeks').value();
	});
}


function imdbLink (title) {
	var page = casper;//Casper.create(options);

	page.then(function () {
		page.echo("Started searching IMDB link for '" + title.name + "'");
	});

	page.thenOpen(
		"http://www.imdb.com/find?s=tt&ttype=ft&q=" + encodeURIComponent(title.name)
	);

	page.then(function () {
		page.echo("Waiting for IMDB link for '" + title.name + "'");
	});

	page.waitForSelector("#main");

	page.then(function () {
		title.url = this.evaluate(function () {
			if ($("a[name='tt']").closest(".findSection").find("td.result_text > a").length === 0) {
				return null;
			}

			return $("a[name='tt']").closest(".findSection").find("td.result_text > a").first().prop("href");
		});

		if (!title.url) {
			this.echo("IMDB link not found for '" + title.name + "'");
		} else {
			title.url = title.url.split("?")[0];
			this.echo("IMDB link for '" + title.name + "' is " + title.url);
		}
	});
}


function imdb(title) {
	var page = casper;//Casper.create(options);

	page.then(function () {
		page.echo("Opening IMDB info for '" + title.name + "' from " + title.url);
	});

	page.thenOpen(title.url);

	page.waitForSelector("div.title_wrapper > h1");

	page.then(function () {
		var imdbInfo;
		this.echo("Parsing IMDB info for '" + title.name + "' from " + this.getCurrentUrl());

		imdbInfo = this.evaluate(function () {
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

		_.extend(title, imdbInfo);
	});
}


casper.echo(
	"Extracting films charted for max " + numWeeks + " week(s) with minimum rating " + minRating
);


charts();

casper.then(function () {
	casper.echo("getting imdb links");
	titles.forEach(imdbLink);
});

casper.then(function () {
	casper.echo("filtering out titles with no imdb link");
	titles = titles.filter(function (title) {
		return !!title.url;
	});
	titles = _.uniqBy(titles, "url");

	casper.echo("getting imdb info");
	titles.forEach(imdb);
});

casper.then(function () {
	var html;

	this.echo("filtering out titles less than min rating");

	if (titles.length === 0) {
		this.die("Zero titles found");
		return;
	}

	titles = titles.filter(function (title) {
		return title.rating >= minRating;
	});

	if (titles.length === 0) {
		this.die("Zero titles left after filtering by rating");
		return;
	}

	this.echo("constructing html for remaining " + titles.length + " shows");

	html = "<thead><tr>" +
		"<th>Title</th><th>Rating</th><th>Weeks</th><th>Genre</th></tr></thead><tbody>";

	titles.forEach(function (title, idx) {
		html += "<tbody data-seq='" + idx + "' data-rating='" + title.rating + "' data-imdb='" +
			title.url + "'><tr><th>" +
			title.name + " (" + title.year + ")" + "</th><th>" +
			(title.rating && title.rating.toFixed(1) || "???") +
			"</th><th>" + title.weeks + "</th><th>" + title.genre +  "</th></tr>" +
			"<tr><td colspan=4>" + title.description + "<br/>" +
			"<a href='" + title.url + "'>" + title.url + "</a></td></tr></tbody>\n";
	});

	html += "</tbody>";

	this.echo("reading ejs source");

	tmpl = fs.read("body.ejs");

	this.echo("creating template from ejs");

	tmpl = _.template(tmpl);

	this.echo("generating html");

	html = tmpl({
		page: "movierentals", icon: "film", headerTitle: "Movie Rentals",
		headerSubtitle: "overview of movie rentals rated greater than " + minRating.toFixed(1) +
		" from the last " + numWeeks + " weeks",
		tableContent: html, listSrcURL: "http://www.officialcharts.com",
		listSrcName: "officialcharts.com",
		lastUpdatedFile: "moviesupdated.json"
	});

	this.echo("writing html");

	fs.write("movierentals.html", html, { mode: "w", charset: "utf-8" });
});

casper.run();
