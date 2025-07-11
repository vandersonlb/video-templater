const { render } = require("@nexrender/core");
const fs = require("fs");

const job = {
  template: {
    src: "file:///home/vanderson/SANDBOX/nexrender_poc/templates/Template_Test.aep",
    composition: "MainComp",
    outputModule: "H.264 - Match Render Settings - 15 Mbps",
    outputExt: "mp4",
    settingsTemplate: "Draft Settings",
  },
  assets: [
    {
      type: "data",
      layerName: "text",
      composition: "MainComp",
      property: "Source Text",
      value: "Lorem ipsum",
    },
  ],
  onRenderProgress: (job, percents) => {
    console.log(`XXX Render progress: ${percents}%`);
  },
};

const main = async () => {
  const result = await render(job, {
    workpath: "/mnt/d/Adobe/_cache_/Nexrender",
    binary: "/mnt/d/Adobe/Adobe After Effects 2025/Support Files/aerender.exe",
    skipCleanup: true,
    addLicense: false,
    debug: true,
    wslMap: "Z",
  });

  console.log(result);
};

main().catch(console.error);
