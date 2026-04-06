import { identification } from "./identification.model.js"
import { compass } from "./compass.model.js"
interface blocks {
    compass: compass;
}
export class scoreSheet {
    identification: identification;
    system: Array<blocks>;
    constructor(identification: identification, system: Array<blocks>) {
        this.identification = identification;
        this.system = system;
    }
}