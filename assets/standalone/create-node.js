// @ts-check

/**
 * @typedef {{ dspModule: WebAssembly.Module; dspMeta: FaustDspMeta; effectModule?: WebAssembly.Module; effectMeta?: FaustDspMeta; mixerModule?: WebAssembly.Module }} FaustDspDistribution
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
 * @typedef {import("./faustwasm").FaustMonoAudioWorkletNode} FaustMonoAudioWorkletNode
 * @typedef {import("./faustwasm").FaustPolyAudioWorkletNode} FaustPolyAudioWorkletNode
 * @typedef {import("./faustwasm").FaustMonoScriptProcessorNode} FaustMonoScriptProcessorNode
 * @typedef {import("./faustwasm").FaustPolyScriptProcessorNode} FaustPolyScriptProcessorNode
 * @typedef {FaustMonoAudioWorkletNode | FaustPolyAudioWorkletNode | FaustMonoScriptProcessorNode | FaustPolyScriptProcessorNode} FaustNode
 */

/**
 * Creates a Faust audio node for use in the Web Audio API.
 *
 * @param {AudioContext} audioContext - The Web Audio API AudioContext to which the Faust audio node will be connected.
 * @param {string} [dspName] - The name of the DSP to be loaded.
 * @param {number} [voices] - The number of voices to be used for polyphonic DSPs.
 * @param {boolean} [sp] - Whether to create a ScriptProcessorNode instead of an AudioWorkletNode.
 * @returns {Promise<{ faustNode: FaustNode | null; dspMeta: FaustDspMeta }>} - An object containing the Faust audio node and the DSP metadata.
 */
const createFaustNode = async (audioContext, dspName = "template", voices = 0, sp = false, bufferSize = 512) => {
    // Set to true if the DSP has an effect
    const FAUST_DSP_HAS_EFFECT = false;

    // Import necessary Faust modules and data
    const { FaustMonoDspGenerator, FaustPolyDspGenerator } = await import("./faustwasm/index.js");

    // Load DSP metadata from JSON
    /** @type {FaustDspMeta} */
    const dspMeta = await (await fetch("./dsp-meta.json")).json();

    // Compile the DSP module from WebAssembly binary data
    const dspModule = await WebAssembly.compileStreaming(await fetch("./dsp-module.wasm"));

    // Create an object representing Faust DSP with metadata and module
    /** @type {FaustDspDistribution} */
    const faustDsp = { dspMeta, dspModule };

    /** @type {FaustNode | null} */
    let faustNode = null;

    // Create either a polyphonic or monophonic Faust audio node based on the number of voices
    if (voices > 0) {

        // Try to load optional mixer and effect modules
        faustDsp.mixerModule = await WebAssembly.compileStreaming(await fetch("./mixer-module.wasm"));

        if (FAUST_DSP_HAS_EFFECT) {
            faustDsp.effectMeta = await (await fetch("./effect-meta.json")).json();
            faustDsp.effectModule = await WebAssembly.compileStreaming(await fetch("./effect-module.wasm"));
        }

        // Create a polyphonic Faust audio node
        const generator = new FaustPolyDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            voices,
            dspName,
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta), soundfiles: {} },
            faustDsp.mixerModule,
            faustDsp.effectModule ? { module: faustDsp.effectModule, json: JSON.stringify(faustDsp.effectMeta), soundfiles: {} } : undefined,
            sp,
            bufferSize
        );
    } else {
        // Create a standard Faust audio node
        const generator = new FaustMonoDspGenerator();
        faustNode = await generator.createNode(
            audioContext,
            dspName,
            { module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta), soundfiles: {} },
            sp,
            bufferSize
        );
    }

    // Return an object with the Faust audio node and the DSP metadata
    return { faustNode, dspMeta };
}

/**
 * Connects an audio input stream to a Faust WebAudio node.
 * 
 * @param {AudioContext} audioContext - The Web Audio API AudioContext to which the Faust audio node is connected.
 * @param {string} id - The ID of the audio input device to connect.
 * @param {FaustNode} faustNode - The Faust audio node to which the audio input stream will be connected.
 * @param {MediaStreamAudioSourceNode} oldInputStreamNode - The old audio input stream node to be disconnected from the Faust audio node.
 * @returns {Promise<MediaStreamAudioSourceNode>} - The new audio input stream node connected to the Faust audio node.
 */
async function connectToAudioInput(audioContext, id, faustNode, oldInputStreamNode) {
    // Create an audio input stream node
    const constraints = {
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            deviceId: id ? { exact: id } : undefined,
        },
    };
    // Get the audio input stream
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (stream) {
        if (oldInputStreamNode) oldInputStreamNode.disconnect();
        const newInputStreamNode = audioContext.createMediaStreamSource(stream);
        newInputStreamNode.connect(faustNode);
        return newInputStreamNode;
    } else {
        return oldInputStreamNode;
    }
};

/**
 * Creates a Faust UI for a Faust audio node.
 * 
 * @param {FaustAudioWorkletNode} faustNode 
 */
async function createFaustUI(divFaustUI, faustNode) {
    const { FaustUI } = await import("./faust-ui/index.js");
    const $container = document.createElement("div");
    $container.style.margin = "0";
    $container.style.position = "absolute";
    $container.style.overflow = "auto";
    $container.style.display = "flex";
    $container.style.flexDirection = "column";
    $container.style.width = "100%";
    $container.style.height = "100%";
    divFaustUI.appendChild($container);
    const faustUI = new FaustUI({
        ui: faustNode.getUI(),
        root: $container,
        listenWindowMessage: false,
        listenWindowResize: true,
    });
    faustUI.paramChangeByUI = (path, value) => faustNode.setParamValue(path, value);
    faustNode.setOutputParamHandler((path, value) => faustUI.paramChangeByDSP(path, value));
    $container.style.minWidth = `${faustUI.minWidth}px`;
    $container.style.minHeight = `${faustUI.minHeight}px`;
    faustUI.resize();
};

/**
 * Request permission to use motion and orientation sensors.
 */
async function requestPermissions() {

    // Explicitly request permission on iOS before calling startSensors()
    if (typeof window.DeviceMotionEvent !== "undefined" && typeof window.DeviceMotionEvent.requestPermission === "function") {
        try {
            const permissionState = await window.DeviceMotionEvent.requestPermission();
            if (permissionState !== "granted") {
                console.warn("Motion sensor permission denied.");
            } else {
                console.log("Motion sensor permission granted.");
            }
        } catch (error) {
            console.error("Error requesting motion sensor permission:", error);
        }
    }

    if (typeof window.DeviceOrientationEvent !== "undefined" && typeof window.DeviceOrientationEvent.requestPermission === "function") {
        try {
            const permissionState = await window.DeviceOrientationEvent.requestPermission();
            if (permissionState !== "granted") {
                console.warn("Orientation sensor permission denied.");
            } else {
                console.log("Orientation sensor permission granted.");
            }
        } catch (error) {
            console.error("Error requesting orientation sensor permission:", error);
        }
    }
}

/**
 * Key2Midi: maps keyboard input to MIDI messages.
 */
class Key2Midi {
    static KEY_MAP = {
        a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7,
        y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16,
        z: "PREV", x: "NEXT", c: "VELDOWN", v: "VELUP"
    };

    constructor({ keyMap = Key2Midi.KEY_MAP, offset = 60, velocity = 100, handler = console.log } = {}) {
        this.keyMap = keyMap;
        this.offset = offset;
        this.velocity = velocity;
        this.velMap = [20, 40, 60, 80, 100, 127];
        this.handler = handler;
        this.pressed = {};

        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
    }

    start() {
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
    }

    stop() {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
    }

    onKeyDown(e) {
        const key = e.key.toLowerCase();
        if (this.pressed[key]) return;
        this.pressed[key] = true;

        const val = this.keyMap[key];
        if (typeof val === "number") {
            const note = val + this.offset;
            this.handler([0x90, note, this.velocity]);
        } else if (val === "PREV") {
            this.offset -= 1;
        } else if (val === "NEXT") {
            this.offset += 1;
        } else if (val === "VELDOWN") {
            const idx = Math.max(0, this.velMap.indexOf(this.velocity) - 1);
            this.velocity = this.velMap[idx];
        } else if (val === "VELUP") {
            const idx = Math.min(this.velMap.length - 1, this.velMap.indexOf(this.velocity) + 1);
            this.velocity = this.velMap[idx];
        }
    }

    onKeyUp(e) {
        const key = e.key.toLowerCase();
        const val = this.keyMap[key];
        if (typeof val === "number") {
            const note = val + this.offset;
            this.handler([0x80, note, this.velocity]);
        }
        delete this.pressed[key];
    }
}

/**
 * Creates a Key2Midi instance.
 * 
 * @param {function} handler - The function to handle MIDI messages.
 * @returns {Key2Midi} - The Key2Midi instance.
 */
function createKey2MIDI(handler) {
    return new Key2Midi({ handler: handler });
}

// Export the functions
export { createFaustNode, createFaustUI, createKey2MIDI, connectToAudioInput, requestPermissions };

