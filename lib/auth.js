const {Octokit} = require("@octokit/rest")
const {retry} = require("@octokit/plugin-retry");
const {throttling} = require("@octokit/plugin-throttling");

class Auth {
    constructor(token) {
        const _Octokit = Octokit.plugin(retry, throttling)
        this.Client = new _Octokit({
            auth: token,
            throttle: {
                onRateLimit: (retryAfter, options, octokit) => {
                    octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
                    if (options.request.retryCount === 0) {
                        octokit.log.info(`Retrying after ${retryAfter} seconds!`);
                        return true;
                    }
                },
                onAbuseLimit: (retryAfter, options, octokit) => {
                    octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`);
                },
            }
        })
    }
}

module.exports = Auth