import { Application } from "./Application";

export interface Configuration {
    applications: Application[];
    port: number;
    log: {
        level: string
    }
}
