/*global angular,CasperError,$*/

var step = 0,
	Casper = require("casper"),
	_ = require('lodash'),
	Q = require("q"),
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
	noop = function () {};


casper.echo("Starting");
casper.start("about:blank");


function charts() {
	var deferred = Q.defer(),
		page = casper;//Casper.create(options);


	page.thenOpen("http://www.officialcharts.com/charts/film-on-video-chart/");

	page.then(function () {
		var titles = this.evaluate(function () {
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

		deferred.resolve(titles);
	});

	return deferred.promise;
}


function imdbLink (title) {
	var deferred = Q.defer(),
		page = casper;//Casper.create(options);

	page.thenOpen(
		"http://www.imdb.com/find?q=" + encodeURIComponent(title.name)
	);

	page.then(function () {
		page.echo("Started searching IMDB link for '" + title.name + "'");
	});

	page.waitForSelector("#main");

	page.then(function () {
		title.url = this.evaluate(function () {
			if ($("td.result_text > a").length === 0) {
				return null;
			}

			return $("td.result_text > a").first().prop("href");
		});

		if (!title.url) {
			this.echo("IMDB link not found for '" + title.name + "'");
		} else {
			title.url = title.url.split("?")[0];
			this.echo("IMDB link for '" + title.name + "' is " + title.url);
		}

		deferred.resolve(title);
	});

	return deferred.promise;
}


function imdb(title) {
	var deferred = Q.defer(),
		page = casper;//Casper.create(options);

	page.then(function () {
		page.echo("Opening IMDB info for '" + title.name + "' from " + title.url);
	});

	page.thenOpen(title.url);

	page.waitForSelector("[itemprop='name']");

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
				rating: num("span[itemprop='ratingValue']"),
				name: text("h1[itemprop='name']"),
				year: num("span#titleYear > a"),
				description: text("div[itemprop='description'] > p"),
				genre: $("span[itemprop='genre']").map(function () {
					return $(this).text().trim();
				}).toArray().join(", ")
			};
		});

		_.extend(title, imdbInfo);

		deferred.resolve(title);
	});

	return deferred.promise;
}


casper.echo(
	"Extracting films charted for max " + numWeeks + " week(s) with minimum rating " + minRating
);


charts().then(function (titles) {
	return Q.all(titles.map(imdbLink));
}).then(function (titles) {
	titles = titles.filter(function (title) {
		return !!title.url;
	});
	titles = _.uniqBy(titles, "url");
	return Q.all(titles.map(imdb));
}).then(function (titles) {
	var html;

	titles = titles.filter(function (title) {
		return title.rating >= minRating;
	});

	this.echo("constructing html for remaining " + titles.length + " shows");

	html = "<thead><th>Title</th><th>Rating</th><th>Weeks</th><th>Genre</th</thead><tbody>";

	titles.forEach(function (title) {
		html += "<tr><th>" + title.name + " (" + title.year + ")" + "</th><th>" +
			(title.rating && title.rating.toFixed(2) || "???") +
			"</th><th>" + title.weeks + "</th><th>" + title.genre +  "</th></tr>" +
			"<tr><td colspan=4>" + title.description + "<br/>" +
			"<a href='" + title.url + "'>" + title.url + "</a></td></tr>";
	});

	html += "</tbody>";

	this.echo("reading ejs source");

	tmpl = fs.read("body.ejs");

	this.echo("creating template from ejs");

	tmpl = _.template(tmpl);

	this.echo("generating html");

	html = tmpl({
		page: "movierentals", headerTitle: "Top Movie Rentals",
		headerSubtitle: "overview of highly rated movie rentals from the last",
		tableContent: html, listSrcURL: "http://www.officialcharts.com",
		listSrcName: "officialcharts.com"
	});

	this.echo("writing html");


	fs.write("movierentals.html", html, "wb");
});

casper.run();