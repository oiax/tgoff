import * as PATH from "path"
import pretty from "pretty"
import { JSDOM } from "jsdom"
import { minimatch } from "minimatch"
import { setTgAttrs } from "./set_tg_attrs.mjs"
import { removeTgAttributes } from "./remove_tg_attributes.mjs"

const generationFuncs = {}

generationFuncs["page"] = (path, siteData) => {
  const filename = PATH.basename(path)
  const page = siteData.pages.find(page => page.path == filename)

  if (page) {
    const pageRoot = page.dom.window.document.body.children[0].cloneNode(true)
    setTgAttrs(pageRoot)

    if (pageRoot.tgAttrs["layout"]) {
      const headAttrs = { title: getTitle(pageRoot) }

      embedComponents(pageRoot, siteData)
      embedArticles(pageRoot, siteData)
      embedArticleLists(pageRoot, siteData)
      embedLinksToArticles(pageRoot, siteData, path)

      const layoutRoot = applyLayout(pageRoot, siteData)
      if (layoutRoot) return renderHTML(layoutRoot, siteData, headAttrs)
      else return renderHTML(pageRoot, siteData, headAttrs)
    }
    else {
      const body = page.dom.window.document.body.cloneNode(true)
      setTgAttrs(body)

      const headAttrs = { title: getTitle(body) }

      embedComponents(body, siteData)
      embedArticles(body, siteData)
      embedArticleLists(body, siteData)
      embedLinksToArticles(body, siteData, path)

      const layoutRoot = applyLayout(body, siteData)
      if (layoutRoot) return renderHTML(body, siteData, headAttrs)
      else return renderHTML(body, siteData, headAttrs)
    }
  }

  return pretty(siteData.documentTemplate.serialize())
}

generationFuncs["article"] = (path, siteData) => {
  const article = siteData.articles.find(article => "src/articles/" + article.path == path)

  if (article) {
    const articleRoot = article.dom.window.document.body.children[0].cloneNode(true)
    setTgAttrs(articleRoot)

    if (articleRoot.tgAttrs["component"]) {
      const componentRoot = getComponentRoot(articleRoot, siteData)
      setTgAttrs(componentRoot)
      embedSlotContents(componentRoot, articleRoot)
      return renderArticle(componentRoot, siteData, path)
    }
    else {
      embedComponents(articleRoot, siteData)
      return renderArticle(articleRoot, siteData, path)
    }
  }

  return pretty(siteData.documentTemplate.serialize())
}

const renderArticle = (articleRoot, siteData, path) => {
  const headAttrs = { title: getTitle(articleRoot) }
  embedLinksToArticles(articleRoot, siteData, path)
  const layoutRoot = applyLayout(articleRoot, siteData)
  if (layoutRoot) return renderHTML(layoutRoot, siteData, headAttrs)
}

const applyLayout = (element, siteData) => {
  if (element.tgAttrs["layout"] === undefined) return

  const layout =
    siteData.layouts.find(layout => layout.path == element.tgAttrs["layout"] + ".html")

  if (layout === undefined) return

  const layoutRoot = layout.dom.window.document.body.cloneNode(true)
  embedSlotContents(layoutRoot, element)
  embedComponents(layoutRoot, siteData)

  const target = layoutRoot.querySelector("tg-content")

  if (target) target.replaceWith(element)

  return layoutRoot
}

const extractSlotContents = element => {
  const slotContents =
    Array.from(element.querySelectorAll("[tg-slot]")).map(elem => {
      const copy = elem.cloneNode(true)
      setTgAttrs(copy)
      return copy
    })

  element.querySelectorAll("[tg-slot]").forEach(elem => elem.remove())

  return slotContents
}

const embedSlotContents = (element, provider) => {
  const slotContents = extractSlotContents(provider)

  element.querySelectorAll("[tg-if-complete]").forEach(wrapper => {
    const complete = Array.from(wrapper.querySelectorAll("tg-slot")).every(slot =>
      slotContents.some(c => c.tgAttrs["slot"] == slot.getAttribute("name"))
    )

    if (complete === false) wrapper.remove()
  })

  element.querySelectorAll("tg-slot").forEach(slot => {
    const content = slotContents.find(c => c.tgAttrs["slot"] == slot.getAttribute("name"))

    if (content) Array.from(content.childNodes).forEach(child => slot.before(child))
    else Array.from(slot.childNodes).forEach(child => slot.before(child))

    slot.remove()
  })
}

const embedComponents = (node, siteData) => {
  const targets = node.querySelectorAll("[tg-component]")

  targets.forEach(target => {
    setTgAttrs(target)
    const componentRoot = getComponentRoot(target, siteData)

    if (componentRoot) {
      embedSlotContents(componentRoot, target)
      target.replaceWith(componentRoot)
    }
  })
}

const getComponentRoot = (element, siteData) => {
  const componentName = element.tgAttrs["component"]

  const component =
    siteData.components.find(component => component.path == componentName + ".html")

  if (component) {
    return component.dom.window.document.body.children[0].cloneNode(true)
  }
}

const embedArticles = (node, siteData) => {
  const targets = node.querySelectorAll("[tg-article]")

  targets.forEach(target => {
    setTgAttrs(target)

    const article =
      siteData.articles.find(article => article.path == target.tgAttrs["article"] + ".html")

    if (article) {
      const articleRoot = article.dom.window.document.body.children[0].cloneNode(true)
      setTgAttrs(articleRoot)

      if (articleRoot.tgAttrs["component"]) {
        const componentRoot = getComponentRoot(articleRoot, siteData)
        setTgAttrs(componentRoot)
        embedSlotContents(componentRoot, articleRoot)
        target.replaceWith(componentRoot)
      }
      else {
        embedComponents(articleRoot, siteData)
        target.replaceWith(articleRoot)
      }
    }
  })
}

const embedArticleLists = (node, siteData) => {
  const targets = node.querySelectorAll("[tg-articles]")

  targets.forEach(target => {
    setTgAttrs(target)
    const pattern = target.tgAttrs["articles"]
    const tag = getTag(target)
    const articles = filterArticles(siteData.articles, pattern, tag)

    if (target.tgAttrs["order-by"]) sortArticles(articles, target.tgAttrs["order-by"])

    articles.forEach(article => {
      const articleRoot = article.dom.window.document.body.children[0].cloneNode(true)
      setTgAttrs(articleRoot)

      if (articleRoot.tgAttrs["component"]) {
        const componentRoot = getComponentRoot(articleRoot, siteData)
        setTgAttrs(componentRoot)
        embedSlotContents(componentRoot, articleRoot)
        target.before(componentRoot)
      }
      else {
        embedComponents(articleRoot, siteData)
        target.before(articleRoot)
      }
    })

    target.remove()
  })
}

const embedLinksToArticles = (node, siteData, path) => {
  const targets = node.querySelectorAll("[tg-links]")

  targets.forEach(target => {
    setTgAttrs(target)
    const pattern = target.tgAttrs["links"]
    const tag = getTag(target)

    const articles = filterArticles(siteData.articles, pattern, tag)

    if (target.tgAttrs["order-by"]) sortArticles(articles, target.tgAttrs["order-by"])

    articles.forEach(article => {
      const articleRoot = article.dom.window.document.body.children[0].cloneNode(true)
      setTgAttrs(articleRoot)

      const copy = target.cloneNode(true)
      embedSlotContents(copy, articleRoot)

      const href = PATH.relative(PATH.dirname(path), PATH.join("src/articles", article.path))
      copy.querySelectorAll("a[href='#']").forEach(anchor => anchor.href = href)

      target.before(copy)
    })

    target.remove()
  })
}

const filterArticles = (articles, pattern, tag) => {
  articles =
    articles.filter(article => {
      if (minimatch(article.path, pattern)) {
        if (tag) {
          const articleRoot = article.dom.window.document.body.children[0].cloneNode(true)
          setTgAttrs(articleRoot)

          if (articleRoot.tgAttrs["tags"]) {
            return articleRoot.tgAttrs["tags"].split(",").includes(tag)
          }
        }
        else {
          return true
        }
      }
    })

  return articles
}

const sortArticles = (articles, orderBy) => {
  const re = /^(index):(asc|desc)$/
  const md = re.exec(orderBy)

  if (md) {
    articles.sort((a, b) => {
      const c = a.dom.window.document.body.children[0]
      const d = b.dom.window.document.body.children[0]

      if (c && d) {
        setTgAttrs(c)
        setTgAttrs(d)
        const i = c.tgAttrs["index"]
        const j = d.tgAttrs["index"]

        if (i) {
          if (j) {
            if (i > j) return 1
            if (i < j) return -1
            if (a.path > b.path) return 1
            if (a.path < b.path) return -1
            return 0
          }
          else {
            return 1
          }
        }
        else {
          if (j) return -1
          else return 1
        }
      }
      else if (c) {
        return 1
      }
      else return -1
    })

    if (md[2] == "desc") articles.reverse()
  }
}

const renderHTML = (root, siteData, headAttrs) => {
  const dom = new JSDOM(siteData.documentTemplate.serialize())
  removeTgAttributes(root)
  dom.window.document.body.replaceWith(root)

  if (headAttrs["title"])
    dom.window.document.head.querySelector("title").textContent = headAttrs["title"]

  return pretty(dom.serialize())
}

const getTitle = element => {
  if (element.tgAttrs["title"]) return element.tgAttrs["title"]

  const h1 = element.querySelector("h1")
  if (h1) return h1.textContent

  const h2 = element.querySelector("h2")
  if (h2) return h2.textContent

  const h3 = element.querySelector("h3")
  if (h3) return h3.textContent

  const h4 = element.querySelector("h4")
  if (h4) return h4.textContent

  const h5 = element.querySelector("h5")
  if (h5) return h5.textContent

  const h6 = element.querySelector("h6")
  if (h6) return h6.textContent
}

const getTag = element => {
  element.tgAttrs["filter"]

  if (element.tgAttrs["filter"]) {
    const re = /^(tag):(.+)$/
    const md = re.exec(element.tgAttrs["filter"])
    if (md) return md[2]
  }
}

export default generationFuncs
