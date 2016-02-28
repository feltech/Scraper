/*global angular,CasperError*/
var step = 0,
	casper = require("casper").create({
		verbose: false,
		onError: function () {
			casper.capture("/tmp/" + (step++) + ".ERROR.png");
		}
	}),
	x = require('casper').selectXPath,
	_ = require('lodash'),
	s = require("underscore.string"),
	dump = require('utils').dump,
	codes = [],
	numCodePages = 4,
	currCodePage = 0;

_.mixin(s.exports());

CasperError = Error;

function capture(name) {
	casper.then(function () {
		this.echo(name);
//		this.capture("/tmp/" + (step++) + "." + name + ".png");
	});
}

function getCodes() {
	var pageCodes = this.getElementsAttribute("input.voucherReveal-peel-bottom-code", "value"),
		pageDescs = this.getElementsInfo("h2.thread-title-text").map(function (info) {
			return info.text;
		}),
		pageCodeData;

	if (pageCodes.length !== pageDescs.length) {
		this.die(
			"Error: pageCodes.length !== pageDescs.length: " +
			pageCodes.length + " !== " + pageDescs.length
		);
	}

	pageCodeData = _(pageCodes)
					.map(s.trim)
					.zip(pageDescs)
					.map(_.partial(_.zipObject, ["code", "description"]))
					.filter(_.partial(_.get, _, "code", null))
					.value();

	[].push.apply(codes, pageCodeData);
}

casper.start("http://www.hotukdeals.com/vouchers/dominos.co.uk");

for (currCodePage = 0; currCodePage < numCodePages; currCodePage++)
{
	capture("Voucher code page " + (currCodePage + 1) + " of " + numCodePages);

	casper.then(getCodes);

	casper.thenClick("a.paginationButton--arrow-next");

	casper.waitForSelectorTextChange("span.paginationButton--current");
}

casper.then(function () {
	casper.echo(
		"Codes: " + _(codes).map(_.partial(_.get, _, "code", "-error-")).toSentence().value()
	);
});

casper.thenOpen("https://www.dominos.co.uk/store");

capture("Dominos homepage");

casper.waitForSelector("#store-finder-search");

casper.then(function () {
	this.fillSelectors("#store-finder-search", {
		"input[type='text']": "CT27NY"
	});
});

capture("find store");

casper.thenClick("#btnStoreSearch");

casper.waitForSelector(x("//button[text()='Deliver To Me'][@ng-click]"));

casper.then(function () {
	var isOpen;
	if (!this.exists(x("//button[text()='Deliver To Me'][@ng-click]"))) {
		isOpen = this.evaluate(function () {
			return !!angular.element("div.store-fulfilment").scope().store.isOpen;
		});
		if (isOpen) {
			this.die("Store is open but 'Deliver To Me' not found");
		} else {
			this.die("Your local Dominos is closed, so cannot try vouchers at this time");
		}
	}
});

capture("choose delivery");

casper.thenClick(x("//button[text()='Deliver To Me'][@ng-click]"));

casper.waitForSelector("button[title='Add Original Cheese & Tomato to your order']");

capture("pick a pizza");

casper.thenClick("button[title='Add Original Cheese & Tomato to your order']");

casper.waitForSelector("#add-to-order");

capture("add to order");

casper.thenClick("#add-to-order");

casper.waitForSelector("button[title='Add Original Cheese & Tomato to your order']");

capture("view basket");

casper.thenClick("a.nav-link-basket");

casper.waitForSelector("div.voucher-code-input");

capture("enter vouchers");

casper.then(function () {

	codes.forEach(function (code) {

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