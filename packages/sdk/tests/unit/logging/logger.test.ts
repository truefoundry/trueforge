import { ConsoleLogger, createLogger, Logger, LogLevel } from "../../../src/core/logging/logger";

function createMockLogger() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

describe("Logger", () => {
    describe("LogLevel", () => {
        it("should have correct log levels", () => {
            expect(LogLevel.Debug).toBe("debug");
            expect(LogLevel.Info).toBe("info");
            expect(LogLevel.Warn).toBe("warn");
            expect(LogLevel.Error).toBe("error");
        });
    });

    describe("ConsoleLogger", () => {
        let consoleLogger: ConsoleLogger;
        let consoleSpy: {
            debug: ReturnType<typeof vi.spyOn>;
            info: ReturnType<typeof vi.spyOn>;
            warn: ReturnType<typeof vi.spyOn>;
            error: ReturnType<typeof vi.spyOn>;
        };

        beforeEach(() => {
            consoleLogger = new ConsoleLogger();
            consoleSpy = {
                debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
                info: vi.spyOn(console, "info").mockImplementation(() => {}),
                warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
                error: vi.spyOn(console, "error").mockImplementation(() => {}),
            };
        });

        afterEach(() => {
            consoleSpy.debug.mockRestore();
            consoleSpy.info.mockRestore();
            consoleSpy.warn.mockRestore();
            consoleSpy.error.mockRestore();
        });

        it("should log debug messages", () => {
            consoleLogger.debug("debug message", { data: "test" });
            expect(consoleSpy.debug).toHaveBeenCalledWith("debug message", { data: "test" });
        });

        it("should log info messages", () => {
            consoleLogger.info("info message", { data: "test" });
            expect(consoleSpy.info).toHaveBeenCalledWith("info message", { data: "test" });
        });

        it("should log warn messages", () => {
            consoleLogger.warn("warn message", { data: "test" });
            expect(consoleSpy.warn).toHaveBeenCalledWith("warn message", { data: "test" });
        });

        it("should log error messages", () => {
            consoleLogger.error("error message", { data: "test" });
            expect(consoleSpy.error).toHaveBeenCalledWith("error message", { data: "test" });
        });

        it("should handle multiple arguments", () => {
            consoleLogger.debug("message", "arg1", "arg2", { key: "value" });
            expect(consoleSpy.debug).toHaveBeenCalledWith("message", "arg1", "arg2", { key: "value" });
        });
    });

    describe("Logger with level filtering", () => {
        let mockLogger: {
            debug: ReturnType<typeof vi.fn>;
            info: ReturnType<typeof vi.fn>;
            warn: ReturnType<typeof vi.fn>;
            error: ReturnType<typeof vi.fn>;
        };

        beforeEach(() => {
            mockLogger = createMockLogger();
        });

        describe("Debug level", () => {
            it("should log all levels when set to debug", () => {
                const logger = new Logger({
                    level: LogLevel.Debug,
                    logger: mockLogger,
                    silent: false,
                });

                logger.debug("debug");
                logger.info("info");
                logger.warn("warn");
                logger.error("error");

                expect(mockLogger.debug).toHaveBeenCalledWith("debug");
                expect(mockLogger.info).toHaveBeenCalledWith("info");
                expect(mockLogger.warn).toHaveBeenCalledWith("warn");
                expect(mockLogger.error).toHaveBeenCalledWith("error");
            });

            it("should report correct level checks", () => {
                const logger = new Logger({
                    level: LogLevel.Debug,
                    logger: mockLogger,
                    silent: false,
                });

                expect(logger.isDebug()).toBe(true);
                expect(logger.isInfo()).toBe(true);
                expect(logger.isWarn()).toBe(true);
                expect(logger.isError()).toBe(true);
            });
        });

        describe("Info level", () => {
            it("should log info, warn, and error when set to info", () => {
                const logger = new Logger({
                    level: LogLevel.Info,
                    logger: mockLogger,
                    silent: false,
                });

                logger.debug("debug");
                logger.info("info");
                logger.warn("warn");
                logger.error("error");

                expect(mockLogger.debug).not.toHaveBeenCalled();
                expect(mockLogger.info).toHaveBeenCalledWith("info");
                expect(mockLogger.warn).toHaveBeenCalledWith("warn");
                expect(mockLogger.error).toHaveBeenCalledWith("error");
            });

            it("should report correct level checks", () => {
                const logger = new Logger({
                    level: LogLevel.Info,
                    logger: mockLogger,
                    silent: false,
                });

                expect(logger.isDebug()).toBe(false);
                expect(logger.isInfo()).toBe(true);
                expect(logger.isWarn()).toBe(true);
                expect(logger.isError()).toBe(true);
            });
        });

        describe("Warn level", () => {
            it("should log warn and error when set to warn", () => {
                const logger = new Logger({
                    level: LogLevel.Warn,
                    logger: mockLogger,
                    silent: false,
                });

                logger.debug("debug");
                logger.info("info");
                logger.warn("warn");
                logger.error("error");

                expect(mockLogger.debug).not.toHaveBeenCalled();
                expect(mockLogger.info).not.toHaveBeenCalled();
                expect(mockLogger.warn).toHaveBeenCalledWith("warn");
                expect(mockLogger.error).toHaveBeenCalledWith("error");
            });

            it("should report correct level checks", () => {
                const logger = new Logger({
                    level: LogLevel.Warn,
                    logger: mockLogger,
                    silent: false,
                });

                expect(logger.isDebug()).toBe(false);
                expect(logger.isInfo()).toBe(false);
                expect(logger.isWarn()).toBe(true);
                expect(logger.isError()).toBe(true);
            });
        });

        describe("Error level", () => {
            it("should only log error when set to error", () => {
                const logger = new Logger({
                    level: LogLevel.Error,
                    logger: mockLogger,
                    silent: false,
                });

                logger.debug("debug");
                logger.info("info");
                logger.warn("warn");
                logger.error("error");

                expect(mockLogger.debug).not.toHaveBeenCalled();
                expect(mockLogger.info).not.toHaveBeenCalled();
                expect(mockLogger.warn).not.toHaveBeenCalled();
                expect(mockLogger.error).toHaveBeenCalledWith("error");
            });

            it("should report correct level checks", () => {
                const logger = new Logger({
                    level: LogLevel.Error,
                    logger: mockLogger,
                    silent: false,
                });

                expect(logger.isDebug()).toBe(false);
                expect(logger.isInfo()).toBe(false);
                expect(logger.isWarn()).toBe(false);
                expect(logger.isError()).toBe(true);
            });
        });

        describe("Silent mode", () => {
            it("should not log anything when silent is true", () => {
                const logger = new Logger({
                    level: LogLevel.Debug,
                    logger: mockLogger,
                    silent: true,
                });

                logger.debug("debug");
                logger.info("info");
                logger.warn("warn");
                logger.error("error");

                expect(mockLogger.debug).not.toHaveBeenCalled();
                expect(mockLogger.info).not.toHaveBeenCalled();
                expect(mockLogger.warn).not.toHaveBeenCalled();
                expect(mockLogger.error).not.toHaveBeenCalled();
            });

            it("should report all level checks as false when silent", () => {
                const logger = new Logger({
                    level: LogLevel.Debug,
                    logger: mockLogger,
                    silent: true,
                });

                expect(logger.isDebug()).toBe(false);
                expect(logger.isInfo()).toBe(false);
                expect(logger.isWarn()).toBe(false);
                expect(logger.isError()).toBe(false);
            });
        });

        describe("shouldLog", () => {
            it("should correctly determine if level should be logged", () => {
                const logger = new Logger({
                    level: LogLevel.Info,
                    logger: mockLogger,
                    silent: false,
                });

                expect(logger.shouldLog(LogLevel.Debug)).toBe(false);
                expect(logger.shouldLog(LogLevel.Info)).toBe(true);
                expect(logger.shouldLog(LogLevel.Warn)).toBe(true);
                expect(logger.shouldLog(LogLevel.Error)).toBe(true);
            });

            it("should return false for all levels when silent", () => {
                const logger = new Logger({
                    level: LogLevel.Debug,
                    logger: mockLogger,
                    silent: true,
                });

                expect(logger.shouldLog(LogLevel.Debug)).toBe(false);
                expect(logger.shouldLog(LogLevel.Info)).toBe(false);
                expect(logger.shouldLog(LogLevel.Warn)).toBe(false);
                expect(logger.shouldLog(LogLevel.Error)).toBe(false);
            });
        });

        describe("Multiple arguments", () => {
            it("should pass multiple arguments to logger", () => {
                const logger = new Logger({
                    level: LogLevel.Debug,
                    logger: mockLogger,
                    silent: false,
                });

                logger.debug("message", "arg1", { key: "value" }, 123);
                expect(mockLogger.debug).toHaveBeenCalledWith("message", "arg1", { key: "value" }, 123);
            });
        });
    });

    describe("createLogger", () => {
        it("should return default logger when no config provided", () => {
            const logger = createLogger();
            expect(logger).toBeInstanceOf(Logger);
        });

        it("should return same logger instance when Logger is passed", () => {
            const customLogger = new Logger({
                level: LogLevel.Debug,
                logger: new ConsoleLogger(),
                silent: false,
            });

            const result = createLogger(customLogger);
            expect(result).toBe(customLogger);
        });

        it("should create logger with custom config", () => {
            const mockLogger = createMockLogger();

            const logger = createLogger({
                level: LogLevel.Warn,
                logger: mockLogger,
                silent: false,
            });

            expect(logger).toBeInstanceOf(Logger);
            logger.warn("test");
            expect(mockLogger.warn).toHaveBeenCalledWith("test");
        });

        it("should use default values for missing config", () => {
            const logger = createLogger({});
            expect(logger).toBeInstanceOf(Logger);
        });

        it("should override default level", () => {
            const mockLogger = createMockLogger();

            const logger = createLogger({
                level: LogLevel.Debug,
                logger: mockLogger,
                silent: false,
            });

            logger.debug("test");
            expect(mockLogger.debug).toHaveBeenCalledWith("test");
        });

        it("should override default silent mode", () => {
            const mockLogger = createMockLogger();

            const logger = createLogger({
                logger: mockLogger,
                silent: false,
            });

            logger.info("test");
            expect(mockLogger.info).toHaveBeenCalledWith("test");
        });

        it("should use provided logger implementation", () => {
            const customLogger = createMockLogger();

            const logger = createLogger({
                logger: customLogger,
                level: LogLevel.Debug,
                silent: false,
            });

            logger.debug("test");
            expect(customLogger.debug).toHaveBeenCalledWith("test");
        });

        it("should default to silent: true", () => {
            const mockLogger = createMockLogger();

            const logger = createLogger({
                logger: mockLogger,
                level: LogLevel.Debug,
            });

            logger.debug("test");
            expect(mockLogger.debug).not.toHaveBeenCalled();
        });
    });

    describe("Default logger", () => {
        it("should have silent: true by default", () => {
            const logger = createLogger();
            expect(logger.shouldLog(LogLevel.Info)).toBe(false);
        });

        it("should not log when using default logger", () => {
            const logger = createLogger();

            logger.info("test");
            expect(logger.isInfo()).toBe(false);
        });
    });

    describe("Edge cases", () => {
        it("should handle empty message", () => {
            const mockLogger = createMockLogger();

            const logger = new Logger({
                level: LogLevel.Debug,
                logger: mockLogger,
                silent: false,
            });

            logger.debug("");
            expect(mockLogger.debug).toHaveBeenCalledWith("");
        });

        it("should handle no arguments", () => {
            const mockLogger = createMockLogger();

            const logger = new Logger({
                level: LogLevel.Debug,
                logger: mockLogger,
                silent: false,
            });

            logger.debug("message");
            expect(mockLogger.debug).toHaveBeenCalledWith("message");
        });

        it("should handle complex objects", () => {
            const mockLogger = createMockLogger();

            const logger = new Logger({
                level: LogLevel.Debug,
                logger: mockLogger,
                silent: false,
            });

            const complexObject = {
                nested: { key: "value" },
                array: [1, 2, 3],
                fn: () => "test",
            };

            logger.debug("message", complexObject);
            expect(mockLogger.debug).toHaveBeenCalledWith("message", complexObject);
        });

        it("should handle errors as arguments", () => {
            const mockLogger = createMockLogger();

            const logger = new Logger({
                level: LogLevel.Error,
                logger: mockLogger,
                silent: false,
            });

            const error = new Error("Test error");
            logger.error("Error occurred", error);
            expect(mockLogger.error).toHaveBeenCalledWith("Error occurred", error);
        });
    });
});
