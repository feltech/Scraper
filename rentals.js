/*global angular,CasperError,$*/

var step = 0,
	Casper = require("casper"),
	_ = require('lodash'),
	s = require("underscore.string"),
	dump = require('utils').dump,
	webserver = require('webserver'),
	execFile = require("child_process").execFile,
	Q = require("q"),
	options = {
		verbose: true,
		logLevel: "warning",
		onError: function () {
			this.capture("/tmp/" + (step++) + ".ERROR.png");
		}
	},
	casper = Casper.create(options),
	numWeeks = parseInt(casper.cli.args[0] || "4", 10),
	minRating = parseFloat(casper.cli.args[1] || "6.0", 10),
	noop = function () {};

_.mixin(s.exports());


CasperError = Error;

casper.echo("Starting");

function imdbLink (title) {
	var deferred = Q.defer(),
		page = Casper.create(options);

	page.start(
		"http://www.imdb.com/find?q=" + encodeURIComponent(title.name)
	);

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
			this.echo("IMDB link for '" + title.name + "' is " + title.url);
		}

		deferred.resolve(title);
	});

	page.run(noop);

	return deferred.promise;
}

function imdb(title) {
	var deferred = Q.defer(),
		page = Casper.create(options);

	page.start(title.url);

	page.waitForSelector("span#titleYear > a");

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

		dump(imdbInfo);

		_.extend(title, imdbInfo);

		deferred.resolve(title);
	});

	page.run(noop);

	return deferred.promise;
}


function piratebay(title) {
	var deferred = Q.defer(),
		page = Casper.create(options);

	page.start(
		"http://thepiratebay.se/search/" +
		encodeURIComponent(title.name + " " + title.year + " jyk")
	);

	page.then(function () {

		_(title).extend({
			download: this.evaluate(function () {
				return $("a.detLink").map(function () {
					return {
						link: $(this).prop("href"),
						description: $(this).text().trim()
					};
				}).toArray();
			}) || [],

			search: "http://thepiratebay.se/search/" +
				encodeURIComponent(title.name + " " + title.year)
		}).value();

		deferred.resolve(title);
	});

	page.run(noop);

	return deferred.promise;
}


casper.echo(
	"Extracting films charted for max " + numWeeks + " week(s) with minimum rating " + minRating
);


function charts() {
	var page = Casper.create(options),
		deferred = Q.defer();

	page.start("http://www.officialcharts.com/charts/film-on-video-chart/");

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

	page.run(noop);

	return deferred.promise;
}


charts().then(function (titles) {
	return Q.all(titles.map(imdbLink));
}).then(function (titles) {
	titles = titles.filter(function (title) {
		return !!title.url;
	});
	return Q.all(titles.map(imdb));
}).then(function (titles) {
	titles = titles.filter(function (title) {
		return title.rating >= minRating;
	});

	dump(titles);
	return Q.all(titles.map(piratebay));
}).then(function (titles) {
	var server = webserver.create();

	server.listen(3000, function (request, response) {
		var html = "";

		response.statusCode = 200;
		response.headers = {
			'Cache': 'no-cache',
			'Content-Type': 'text/html'
		};
		html += "<html><head><title>New Releases</title>" +
				"<link rel='stylesheet' href='https://maxcdn.bootstrapcdn.com/bootstrap/" +
				"3.3.6/css/bootstrap.min.css' integrity='sha384-1q8mTJOASx8j1Au+a5WDVnPi" +
				"2lkFfwwEAa8hDDdjZlpLegxhjVME1fgjWPGmkzs7' crossorigin='anonymous'>" +
				"</head><body>" +
				"<table class='table table-striped'><thead><th>Title</th><th>Rating</th>" +
				"<th>Weeks</th><th>Genre</th</thead><tbody>";

		titles.forEach(function (title) {
			html += "<tr><th>" + title.name + " (" + title.year + ")" + "</th><th>" +
				(title.rating && title.rating.toFixed(2) || "???") +
				"</th><th>" + title.weeks + "</th><th>" + title.genre +  "</th></tr>" +
				"<tr><td colspan=4>" + title.description + "<br/>" +
				"<a href='" + title.url + "'>" + title.url + "</a>" +
				"<br /><a href='" + title.search + "'>" + title.search + "</a><ul>";
			title.download.forEach(function (download) {
				html += "<li><a href='" + download.link + "'>" + download.description +
					"</a></li>";
			});
			html += "</ul></td></tr>";
		});

		html += "</tbody></table></body></html>";

		response.write(html);
		response.close();

		casper.exit();
	});

	execFile("xdg-open", ['http://localhost:3000']);
});
