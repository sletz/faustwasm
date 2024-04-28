import { FaustBaseWebAudioDsp } from "./FaustWebAudioDsp";
import type { AudioData, FaustDspMeta, FaustUIItem, LooseFaustDspFactory } from "./types";

/** Read metadata and fetch soundfiles */
class SoundfileReader {
    static get fallbackPaths() { return [location.href, location.origin, "http://127.0.0.1:8000"]; }

    static toAudioData(audioBuffer: AudioBuffer) {
        const { sampleRate, numberOfChannels } = audioBuffer;
        return {
            sampleRate,
            audioBuffer: new Array(numberOfChannels).fill(null).map((v, i) => audioBuffer.getChannelData(i))
        } as AudioData;
    }

    private static findSoundfilesFromMeta(dspMeta: FaustDspMeta) {
        const soundfiles: LooseFaustDspFactory["soundfiles"] = {};
        const callback = (item: FaustUIItem) => {
            if (item.type === "soundfile") {
                const urls = FaustBaseWebAudioDsp.splitSoundfileNames(item.url);
                // soundfiles.map[item.label] = urls;
                urls.forEach(url => soundfiles[url] = null);
            }
        };
        FaustBaseWebAudioDsp.parseUI(dspMeta.ui, callback);
        return soundfiles;
    }
    /**
     * Check if the file exists.
     * 
     * @param url : the url of the file to check
     * @returns : true if the file exists, otherwise false
     */
    private static async checkFileExists(url: string): Promise<boolean> {
        try {
            console.log(`"checkFileExists" url: ${url}`);
            const response = await fetch(url, { method: "HEAD" });
            return response.ok; // Will be true if the status code is 200-299
        } catch (error) {
            console.error('Fetch error:', error);
            return false;
        }
    }
    private static async fetchSoundfile(url: string, audioCtx: BaseAudioContext) {
        console.log(`Loading sound file from ${url}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load sound file from ${url}: ${response.statusText}`);
        // Decode the audio data
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        return this.toAudioData(audioBuffer);
    }
    private static async loadSoundfile(filename: string, metaUrls: string[], soundfiles: LooseFaustDspFactory["soundfiles"], audioCtx: BaseAudioContext) {
        if (soundfiles[filename]) return;
        const urlsToCheck = [filename, ...[...metaUrls, ...this.fallbackPaths].map(path => new URL(filename, path.endsWith("/") ? path : `${path}/`).href)];
        const checkResults = await Promise.all(urlsToCheck.map(url => this.checkFileExists(url)));
        const successIndex = checkResults.findIndex(r => !!r);
        if (successIndex === -1) throw new Error(`Failed to load sound file ${filename}, all check failed.`);
        soundfiles[filename] = await this.fetchSoundfile(urlsToCheck[successIndex], audioCtx);
    }
    static async loadSoundfiles(dspMeta: FaustDspMeta, soundfilesIn: LooseFaustDspFactory["soundfiles"], audioCtx: BaseAudioContext) {
        const metaUrls = FaustBaseWebAudioDsp.extractUrlsFromMeta(dspMeta);
        const soundfiles = this.findSoundfilesFromMeta(dspMeta);
        for (const id in soundfiles) {
            if (soundfilesIn[id]) {
                soundfiles[id] = soundfilesIn[id];
                continue;
            }
            try {
                await this.loadSoundfile(id, metaUrls, soundfiles, audioCtx);
            } catch (error) {
                console.error(error);
            }
        }
        return soundfiles;
    }
}

export default SoundfileReader;