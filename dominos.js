/*global angular,CasperError*/
var POSTCODE = "CT27NY",
	step = 0,
	casper = require("casper").create({
		verbose: true,
		logLevel: "warning",
		onError: function () {
			casper.capture("/tmp/" + (step++) + ".ERROR.png");
		},
		waitTimeout: 5000,
		viewportSize: {width: 1280, height: 1024}
	}),
	x = require('casper').selectXPath,
	_ = require('lodash'),
	dump = require('utils').dump,
	codes = [],
	numCodePages = 4,
	currCodePage = 0;

CasperError = Error;

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



function getCodes() {
	var pageCodes = this.getElementsAttribute("input.voucherReveal-peel-bottom-code", "value"),
		pageDescs = this.getElementsInfo("p.thread-title-text").map(function (info) {
			return info.text;
		}),
		pageCodeData;
	if (pageCodes.length !== pageDescs.length) {
		this.die(
			"Error: pageCodes.length !== pageDescs.length: " +
			pageCodes.length + " !== " + pageDescs.length
		);
	}

	casper.echo("Got codes: " + pageCodes);

	pageCodeData = _(pageCodes)
					.map(function (code) { return code.trim(); })
					.zip(pageDescs)
					.map(_.partial(_.zipObject, ["code", "description"]))
					.filter(_.partial(_.get, _, "code", null))
					.value();

	[].push.apply(codes, pageCodeData);

}

casper.start("http://www.hotukdeals.com/vouchers/dominos.co.uk");

say("on voucher page");

for (currCodePage = 0; currCodePage < numCodePages; currCodePage++)
{
	capture("Voucher code page " + (currCodePage + 1) + " of " + numCodePages);

	casper.then(getCodes);

	casper.then(function () {
		this.echo("--- going to next page");
	});

	casper.thenClick("a.paginationButton--arrow-next");

	casper.waitForSelectorTextChange("span.paginationButton--current");
}

casper.thenOpen("https://www.dominos.co.uk");

capture("Dominos homepage");

casper.waitForSelector("#store-finder-search");

say("searching for store");

casper.then(function () {
	this.fillSelectors("#store-finder-search", {
		"input[type='text']": POSTCODE
	});
});

capture("find store");

say("waiting for store search button");

casper.waitForSelector("#btn-delivery");

say("clicking to search for store");

casper.thenClick("#btn-delivery");

//say("waiting for Deliver To Me button");
//
//casper.waitForSelector(x("//button[text()='Deliver To Me'][@ng-click]"));
//
//say("checking dominos is open");
//
//casper.then(function () {
//	var isOpen;
//	if (!this.exists(x("//button[text()='Deliver To Me'][@ng-click]"))) {
//		isOpen = this.evaluate(function () {
//			return !!angular.element("div.store-fulfilment").scope().store.isOpen;
//		});
//		if (isOpen) {
//			this.die("Store is open but 'Deliver To Me' not found");
//		} else {
//			this.die("Your local Dominos is closed, so cannot try vouchers at this time");
//		}
//	} else {
//		this.echo("--- store is open!")
//	}
//});
//
//capture("choose delivery");
//
//casper.thenClick(x("//button[text()='Deliver To Me'][@ng-click]"));

say("waiting for the menu to show");

casper.waitForSelector("button[title='Add Vegi Supreme to my order']");

capture("pick a pizza");

casper.thenClick("button[title='Add Vegi Supreme to my order']");

say("going to basket");

casper.thenClick("a.nav-link-basket");

capture("view basket");

casper.waitForSelector("div.voucher-code-input");

capture("enter vouchers");

say("entering codes...");

casper.then(function () {

	codes.forEach(function (code) {

		say("entering code: " + code.code);

		this.then(function () {
			this.fillSelectors("div.voucher-code-input > form", { "input[type='text']": code.code });
		});

		this.thenClick("button.btn-add-voucher");

		this.waitWhileSelector("button.btn-add-voucher[disabled]");

		this.then(function () {
			code.status = this.fetchText("div.voucher-code-input > p.help-block").trim();
		});
	}.bind(this));
});

capture("finish");

casper.then(function () {
	var working = codes.filter(function (code) {
		return !/invalid|expired|Voucher Used/i.test(code.status);
	}).map(function (code) {
		return code.description + " [" + code.code + "]";
	});

	this.echo(codes.map(function (code) {
		return code.description + " [" + code.code + "] = \"" + code.status + "\"";
	}).join("\n"));

	this.echo("\n\n=======Working vouchers (" + working.length + "/" + codes.length + ")========");
	this.echo(working.join("\n"));
	this.echo("\n");
});

casper.run();