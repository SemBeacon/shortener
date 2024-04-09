const cluster = require('cluster');
import { cpus } from 'os';
import { App } from '../App';

const app = new App();

if (cluster.isPrimary) {
    const workers = [];
    app.logger.info(`Master ${process.pid} started. Initializing workers ...`);
    const CPUS: any = cpus();
    CPUS.forEach(() => {
        const worker = cluster.fork();
        workers.push(worker);
    });
} else {
    app.start();
}
