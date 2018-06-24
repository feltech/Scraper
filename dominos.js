/*global angular,CasperError*/
var POSTCODE,
	step = 0,
	casper = require("casper").create({
		verbose: true,
		logLevel: "warning",
		onError: function () {
			casper.capture("/tmp/" + (step++) + ".ERROR.png");
		},
		waitTimeout: 60000,
		viewportSize: {width: 1280, height: 1024}
	}),
	x = require('casper').selectXPath,
	_ = require('lodash'),
	dump = require('utils').dump,
	codes = [],
	numCodePages = 4,
	currCodePage = 0;

CasperError = Error;

POSTCODE = casper.cli.args[0] || casper.die("No postcode specified");

casper.echo("Searching for working voucher codes in '" + POSTCODE + "'");

function say(text) {
	casper.then(function () {
		this.echo("--- " + text);
	});
}

function capture(name) {
	casper.then(function () {
		this.echo(name);
		this.capture("/tmp/" + (step++) + "." + name + ".png");
	});
}

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

(reportErrors(function take10s() {
	var generated = [],
		alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
		i,j;

	for (i = 0; i < alphabet.length; i++) {
		for (j = 0; j < alphabet.length; j++) {
			generated.push({
				code: "TAKE10" + alphabet[i] + alphabet[j], description: "Generated TAKE10 code"
			});
		}
	}

	[].push.apply(codes, generated);

})());

function getCodes() {
	var sections = _.compact(this.evaluate(function () {
			return $("article.thread--voucher").toArray().map(function (el) {
				return $(el).find("[data-voucher-button]").data() && $(el).attr("id") || null;
			});
		})),
		pageCodes = this.evaluate(function (sections) {
			return sections.map(function (id) {
				return {
					id: $("#"+id).find("[data-voucher-button]").data().voucherButton.id,

					desc: $("#"+id).find("strong.thread-title").text().trim()
					.replace(/\s{2,}/g, " ").replace("INSTRUCTIONS: ", "")
					.replace(" Read more", "")
				};
			});
		}, sections),
		pageCodeData;

	_(pageCodes).each(function (pageCode) {

//		say("getting voucher for id " + pageCode.id);

		casper.then(function () {
			this.evaluate(function (id) {
				$.cookie("show_voucher", id);
			}, pageCode.id);
		});

//		say("reloading to show popup");

		casper.then(function () {
			this.reload();
		});

//		say("waiting for popup with code for id " + pageCode.id);

		casper.waitForSelector("div.popover-content span.voucher-code");

//		say("scraping popup with code for id " + pageCode.id);

		casper.then(reportErrors(function () {
			var code = casper.getElementInfo("div.popover-content span.voucher-code").text;
			var multiCodes = code.trim().replace(/"/g, "").split(" ");
			_(multiCodes).each(function (code) {
				if (code) {
					codes.push({
						code: code,
						description: pageCode.desc
					});
				}
			});

//			this.echo(
//				"popup with code for id " + pageCode.id + " is '" + code + "' with description '" +
//				pageCode.desc + "'"
//			);
		}));
	});

	say("removing cookie");

	casper.then(function () {
		this.evaluate(function () {
			$.removeCookie("show_voucher");
		});
	});

	say("reloading to hide popup");

	casper.then(function () {
		this.reload();
	});
}

var pageNumSelector = "#pagination > nav > div > span.tGrid-cell.tGrid-cell--shrink" +
".vAlign--all-m.space--h-4.space--v-1.text--color-brandPrimary > button > span.hide--toW2";

casper.start("https://www.hotukdeals.com/vouchers/dominos.co.uk");

say("waiting for load");

casper.waitForSelector("[data-voucher-button]");

casper.then(reportErrors(getCodes));

for (currCodePage = 1; currCodePage < numCodePages; currCodePage++)
{
	capture("Voucher code page " + (currCodePage + 1) + " of " + numCodePages);

	casper.then(function () {
		say("going to next page");

		if (casper.visible(pageNumSelector)) {
			casper.thenClick("a[rel='next']");
			casper.waitForSelectorTextChange(pageNumSelector);
			casper.then(reportErrors(getCodes));
		} else {
			casper.say("no more pages of codes, breaking early.");
			return;
		}
	});
}


casper.thenOpen("https://www.dominos.co.uk");

capture("Dominos homepage");

casper.waitForSelector("#store-finder-search");

say("searching for store");

casper.then(reportErrors(function () {
	this.fillSelectors("#store-finder-search", {
		"input[type='text']": POSTCODE
	});
}));

capture("find store");

say("waiting for store search button");

casper.waitForSelector("#btn-delivery");

say("clicking to search for store");

casper.thenClick("#btn-delivery");

say("waiting for the menu button");

casper.waitForSelector("#menu-selector");

say("clicking to show menu");

casper.thenClick("#menu-selector");

say("waiting for the menu to show");

casper.waitForSelector("button[resource-name='AddToBasket']");

capture("pick a pizza");

casper.thenClick("button[resource-name='AddToBasket']");

say("going to basket");

casper.thenClick("a.nav-link-basket");

capture("view basket");

casper.waitForSelector("div.voucher-code-input");

capture("enter vouchers");

say("entering codes...");

casper.then(reportErrors(function () {

	codes.forEach(reportErrors(function (code) {

//		say("entering code: " + code.code);

		this.then(function () {
			this.fillSelectors("div.voucher-code-input > form", { "input[type='text']": code.code });
		});

		this.thenClick("button.btn-add-voucher");

		this.waitWhileSelector("button.btn-add-voucher[disabled]");

		this.then(function () {
			code.status = this.fetchText("div.voucher-code-input > p.help-block").trim();
		});

		this.then(function () {
			// Clear the voucher, if it was successfully added, so subsequent vouchers can be
			// checked.
			if (this.exists("[data-voucher] .basket-product-actions button")) {
				say("voucher worked! clearing voucher");
				this.thenClick("[data-voucher] .basket-product-actions button");
				say("cleared voucher, awaiting confirmation dialog");
				this.waitForSelector('div.modal.in button[resource-name="OkButton"]');
				say("confirming");
				this.thenClick('div.modal.in button[resource-name="OkButton"]');
				say("waiting for voucher to clear");
				this.waitWhileSelector("[data-voucher] .basket-product-actions button");
			}
		});
	}).bind(this));
}));

capture("finish");

casper.then(reportErrors(function () {

	say("analysing codes...");

	var working = codes.filter(function (code) {
		return !/invalid|expired|Voucher Used|already been used/i.test(code.status);
	}).map(function (code) {
		return code.description + " [" + code.code + "]";
	}),
	grouped = _.groupBy(codes, function (code) {
		return code.status;
	});

	this.echo(_.map(grouped, function (group, status) {
		return group.map(function (code) {
			return "[" + code.code + "]";
		}).join("") + ": " + status;
	}).join("\n"));

	this.echo("\n\n=======Working vouchers (" + working.length + "/" + codes.length + ")========");
	this.echo(working.join("\n"));
	this.echo("\n");

	if (working.length) {
		casper.exit(0);
	} else {
		casper.exit(100);
	}
}));

casper.run();