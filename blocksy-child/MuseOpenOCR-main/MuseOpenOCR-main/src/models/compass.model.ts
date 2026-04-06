export class compass {
    clef: string;
    keySignature: string;
    timeSignature: string;
    beats: Array<any>;

    constructor(clef:string, keySignature:string, timeSignature:string, beats:Array<any>) {
        this.clef = clef;
        this.keySignature = keySignature;
        this.timeSignature = timeSignature;
        this.beats = beats;
    }
}