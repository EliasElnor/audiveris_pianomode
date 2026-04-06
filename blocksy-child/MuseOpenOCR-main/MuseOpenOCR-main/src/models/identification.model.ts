import { encoding } from "./encoding.model.js"
export class identification {
    title: string;
    composer: string;
    lyricist: string;
    rights: string;
    encoding: encoding;
    constructor(title:string, composer:string, lyricist:string, rights:string, encoding: encoding) {
        this.title = title;
        this.composer = composer;
        this.lyricist = lyricist;
        this.rights = rights;
        this.encoding = encoding;
    }
}