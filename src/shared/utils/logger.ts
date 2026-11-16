const logger = {
  info: (message: string) => {
    console.log(`[INFO] ${message}`);
  },

  warn: (message: string) => {
    console.warn(`[WARN] ${message}`);
  },

  error: (message: string) => {
    console.error(`[ERROR] ${message}`);
  },

  debug: (message: string) => {
    if (process.env.DEBUG) {
      console.debug(`[DEBUG] ${message}`);
    }
  },
};

export default logger;
