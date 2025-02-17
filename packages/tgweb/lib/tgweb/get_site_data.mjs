import fs from "fs"
import TOML from "@ltd/j-toml"
import glob from "glob"
import { getTemplate } from "./get_template.mjs"
import { normalizeSiteProperties } from "./normalize_site_properties.mjs"
import { mergeProperties } from "./merge_properties.mjs"
import { showTomlSytaxError } from "./show_toml_syntax_error.mjs"

const getSiteData = directory => {
  const cwd = process.cwd()

  const siteData = {
    pages: [],
    layouts: [],
    segments: [],
    wrappers: [],
    sharedWrappers: [],
    articles: [],
    components: [],
    sharedComponents: [],
    icons: [],
    properties: {
      main: {
        scheme: "http",
        host: "localhost",
        port: 3000,
        "root-url": "http://localhost:3000/"
      }
    },
    options: {
      buildDrafts: false
    }
  }

  process.chdir(directory)

  const site_toml_path = "src/site.toml"

  if (fs.existsSync(site_toml_path)) {
    const source = fs.readFileSync(site_toml_path)

    try {
      const properties = TOML.parse(source, {joiner: "\n", bigint: false})
      siteData.properties = mergeProperties(siteData.properties, properties)
    }
    catch (error) {
      showTomlSytaxError(site_toml_path, source, error)
    }
  }

  normalizeSiteProperties(siteData.properties)

  if (fs.existsSync("src/components")) {
    siteData.components =
      glob.sync("src/components/**/*.html").map(path => getTemplate(path, "component"))
  }

  if (fs.existsSync("src/shared_components")) {
    siteData.sharedComponents =
      glob.sync("src/shared_components/**/*.html").map(path => getTemplate(path, "component"))
  }

  siteData.wrappers =
    glob.sync("src/@(pages|articles)/**/_wrapper.html").map(path => getTemplate(path, "wrapper"))

  if (fs.existsSync("src/shared_wrappers")) {
    siteData.sharedWrappers =
      glob.sync("src/shared_wrappers/**/*.html").map(path => getTemplate(path, "wrapper"))
  }

  if (fs.existsSync("src/articles")) {
    siteData.articles =
      glob.sync("src/articles/**/!(_wrapper).html").map(path =>
        getTemplate(path, "article", siteData.properties)
      )
  }

  if (fs.existsSync("src/segments")) {
    siteData.segments = glob.sync("src/segments/**/*.html").map(path =>
      getTemplate(path, "segment")
    )
  }

  if (fs.existsSync("src/layouts")) {
    siteData.layouts = glob.sync("src/layouts/**/*.html").map(path => getTemplate(path, "layout"))
  }

  if (fs.existsSync("src/pages")) {
    siteData.pages =
      glob.sync("src/pages/**/!(_wrapper).html").map(path =>
        getTemplate(path, "page", siteData.properties)
      )
  }

  if (fs.existsSync("src/icons/favicon.ico")) siteData.icons.push("favicon.ico")
  if (fs.existsSync("src/icons/icon.svg")) siteData.icons.push("icon.svg")
  if (fs.existsSync("src/icons/180.png")) siteData.icons.push("180.png")
  if (fs.existsSync("src/icons/192.png")) siteData.icons.push("192.png")
  if (fs.existsSync("src/icons/512.png")) siteData.icons.push("512.png")

  process.chdir(cwd)

  return siteData
}

export { getSiteData }
