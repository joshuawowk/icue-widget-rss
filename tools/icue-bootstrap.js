
let uniqueId = "{844cf1a5-b2b0-4834-a753-28d210755d66}";

let tick_offset = 0;
let tick_start = Date.now();
let iCUE_initialized = false;



let icueEvents = {
	"onDataUpdated": null,
	"onICUEInitialized": null,
	"onUpdateRequested": null
};

function updateTick(value) {
	tick_offset = value;
	tick_start = Date.now();
}

function tick() {
	return Date.now() - tick_start + tick_offset;
}

function applyData(data) {
	uniqueId = data.uniqueId;


	if (iCUE_initialized && typeof icueEvents.onDataUpdated === 'function') {
		icueEvents.onDataUpdated();
	}
}

function requestUpdate() {
	if (iCUE_initialized && typeof icueEvents.onUpdateRequested === 'function') {
		icueEvents.onUpdateRequested();
	}
}

// Store channel reference globally
window.icueChannel = null;

new QWebChannel(qt.webChannelTransport, function(channel) {
	window.icueChannel = channel;

	applyData(channel.objects.backend.data);
	channel.objects.backend.dataChanged.connect(applyData);
	channel.objects.backend.updateRequested.connect(requestUpdate);

	updateTick(channel.objects.backend.tick);

	if (typeof window.tr !== 'function') {
		window.tr = function(s) { return channel.objects.backend.tr(s); };
	}
	if (!window.iCUE) {
		window.iCUE = channel.objects.backend.iCUEGlobalObject;
	}

	if (!window.plugins) { window.plugins = {}; }

	// Dispatch event to notify that channel is ready
	document.dispatchEvent(new Event('icue-channel-ready'));
});

// Initialize after both channel and DOM are ready
{
	let channelReady = false;
	let domReady = false;

	function tryInit() {
		if (!channelReady || !domReady) {
			return;
		}
		if (iCUE_initialized) {
			return;
		}

		let channel = window.icueChannel;
		if (!channel) {
			console.error("HtmlDataProvider: icueChannel is null");
			return;
		}

		function doInit() {
			if (iCUE_initialized) {
				return;
			}
			iCUE_initialized = true;

			if (typeof icueEvents.onICUEInitialized === 'function') {
				icueEvents.onICUEInitialized();
			} else {
				console.log("HtmlDataProvider: onICUEInitialized is not defined by widget");
			}
		}

		channel.objects.backend.isInitialized().then(function(isInitialized) {
			if (isInitialized) {
				doInit();
			}
		});

		channel.objects.backend.initialized.connect(function() {
			doInit();
		});
	}

	document.addEventListener('icue-channel-ready', function() {
		channelReady = true;
		tryInit();
	});

	document.addEventListener('DOMContentLoaded', function() {
		domReady = true;
		tryInit();
	});

	// Fallback: check if channel is already ready (event may have fired before listener was added)
	if (window.icueChannel) {
		channelReady = true;
		tryInit();
	}
}
