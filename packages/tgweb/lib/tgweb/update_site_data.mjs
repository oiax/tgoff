import * as PATH from "path"
import { slash } from "./slash.mjs"
import { dbg } from "./debugging.mjs"
import getType from "./get_type.mjs"
import { getSiteData } from "./get_site_data.mjs"
import { setDependencies } from "./set_dependencies.mjs"
import { setUrlProperty } from "./set_url_property.mjs"
import { getTemplate } from "./get_template.mjs"

if (dbg === undefined) dbg(undefined)

const updateSiteData = (siteData, path) => {
  const cwd = process.cwd()
  const type = getType(path)
  const posixPath = slash(path)

  if (type == "site.yml") {
    const newSiteData = getSiteData(process.cwd())
    siteData.properties = newSiteData.properties
    siteData.pages = newSiteData.pages
    siteData.segments = newSiteData.segments
    siteData.articles = newSiteData.articles
    siteData.components = newSiteData.components
    siteData.layouts = newSiteData.layouts
    siteData.wrappers = newSiteData.wrappers
  }
  else if (type === "component") {
    const component = siteData.components.find(c => "src/" + c.path === posixPath)

    if (component) {
      updateTemplate(component, path)
    }
    else {
      process.chdir("src")
      const shortPath = posixPath.replace(/^src\//, "")
      siteData.components.push(getTemplate(shortPath, "component"))
    }
  }
  else if (type === "segment") {
    const segment = siteData.segments.find(s => "src/" + s.path === posixPath)

    if (segment) {
      updateTemplate(segment, path)
    }
    else {
      process.chdir("src")
      const shortPath = posixPath.replace(/^src\//, "")
      siteData.segments.push(getTemplate(shortPath, "segment"))
    }
  }
  else if (type === "layout") {
    const layout = siteData.layouts.find(l => "src/" + l.path === posixPath)

    if (layout) {
      updateTemplate(layout, path)
      setDependencies(layout, siteData)
    }
    else {
      process.chdir("src")
      const shortPath = posixPath.replace(/^src\//, "")
      siteData.layouts.push(getTemplate(shortPath, "layout"))
    }
  }
  else if (type === "article") {
    const article = siteData.articles.find(a => "src/" + a.path === posixPath)

    if (article) {
      updateTemplate(article, path, siteData.properties)
      setUrlProperty(article.frontMatter, siteData, article.path)
      setDependencies(article, siteData, true)
    }
    else {
      process.chdir("src")
      const shortPath = posixPath.replace(/^src\//, "")
      const newArticle = getTemplate(shortPath, "article", siteData.properties)

      setUrlProperty(newArticle.frontMatter, siteData, newArticle.path)
      setDependencies(newArticle, siteData)

      siteData.articles.push(newArticle)

      siteData.pages.forEach(p => setDependencies(p, siteData))

      siteData.articles.forEach(a => {
        if (a.path !== shortPath) setDependencies(a, siteData)
      })
    }
  }
  else if (type === "page") {
    const page = siteData.pages.find(p => "src/" + p.path === posixPath)

    if (page) {
      updateTemplate(page, path)
      setUrlProperty(page.frontMatter, siteData, posixPath)
      setDependencies(page, siteData)
    }
    else {
      process.chdir("src")
      const shortPath = posixPath.replace(/^src\//, "")
      siteData.pages.push(getTemplate(shortPath, "page", siteData.properties))
    }
  }
  else if (type === "wrapper") {
    const wrapper = siteData.wrappers.find(w => "src/" + w.path === posixPath)

    if (wrapper) {
      updateTemplate(wrapper, path)
      setDependencies(wrapper, siteData)
    }
    else {
      process.chdir("src")
      const shortPath = posixPath.replace(/^src\//, "")
      const wrapper = getTemplate(shortPath, "wrapper")
      setDependencies(wrapper, siteData)
      siteData.wrappers.push(wrapper)

      const wrapperName = wrapper.path.replace(/\.html$/, "")

      if (wrapper.path.startsWith("pages/")) {
        siteData.pages.forEach(page => {
          if (page.path.includes("/")) {
            const dir = PATH.dirname(page.path)

            if (wrapper.path === slash(PATH.join(dir, "_wrapper.html"))) {
              replaceWrapper(page, wrapperName)
            }
          }
          else {
            if (wrapper.path === "pages/_wrapper.html") {
              replaceWrapper(page, wrapperName)
            }
          }
        })
      }
      else if (wrapper.path.startsWith("articles/")) {
        siteData.articles.forEach(article => {
          if (article.path.includes("/")) {
            const dir = PATH.dirname(article.path)

            if (wrapper.path === slash(PATH.join(dir, "_wrapper.html"))) {
              replaceWrapper(article, wrapperName)
            }
          }
          else {
            if (wrapper.path === "articles/_wrapper.html") {
              replaceWrapper(article, wrapperName)
            }
          }
        })
      }
    }
  }

  process.chdir(cwd)
}

const updateTemplate = (template, path) => {
  const newTemplate = getTemplate(path, undefined)
  template.frontMatter = newTemplate.frontMatter
  template.dom = newTemplate.dom
}

const replaceWrapper = (template, wrapperName) => {
  template.dependencies = template.dependencies.filter(dep => dep.endsWith("/_wrapper.html"))
  template.dependencies.push(wrapperName)
}

export { updateSiteData }
