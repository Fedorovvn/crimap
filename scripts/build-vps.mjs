process.env.SITE_TARGET = "vps";
process.argv = [process.execPath, "vinext", "build"];
await import("../node_modules/vinext/dist/cli.js");
