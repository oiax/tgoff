import * as PATH from "path"
import fs from "fs"
import { escape } from "html-escaper"
import render from "dom-serializer"
import getType from "./get_type.mjs"
import { parseDocument, DomUtils } from "htmlparser2"
import { getDocumentProperties } from "./get_document_properties.mjs"
import { getTitle } from "./get_title.mjs"
import { getWrapper } from "./get_wrapper.mjs"
import { getLayout } from "./get_layout.mjs"
import { filterArticles } from "./filter_articles.mjs"
import { sortArticles } from "./sort_articles.mjs"
import { inspectDom } from "../utils/inspect_dom.mjs"
import { mergeProperties } from "./merge_properties.mjs"

if (inspectDom === undefined) { inspectDom() }

const __dirname = import.meta.dirname
const dataPath = PATH.resolve(PATH.join(__dirname, "..", "..", "resources", "material_symbols.txt"))
const symbolsData = fs.readFileSync(dataPath)
const symbolNameCodepointMapping = {}

symbolsData.toString().split("\n").map(line => {
  const a = line.split(" ")
  symbolNameCodepointMapping[a[0]] = a[1]
})

const renderWebPage = (path, siteData) => {
  const type = getType(path)

  if (type === "page") return renderPage(path, siteData)
  else if (type === "article") return renderArticle(path, siteData)
}

const renderPage = (path, siteData) => {
  const relPath = path.replace(/^src\//, "")
  const page = siteData.pages.find(page => page.path == relPath)

  const state =
    {
      path,
      container: undefined,
      innerContent: [],
      inserts: [],
      referencedComponentNames: [],
      referencedSegmentNames: [],
      hookName: undefined,
      itemIndex: 0
    }

  if (page === undefined) {
    console.log(`Page '${relPath}' is not found.`)
    return
  }

  const wrapper = getWrapper(siteData, page.path)
  const layout = getLayout(siteData, page, wrapper)
  const documentProperties = getDocumentProperties(page, wrapper, layout, siteData.properties)

  documentProperties["title"] = getTitle(documentProperties, page.dom)

  if (wrapper) {
    return applyWrapper(page, wrapper, layout, siteData, documentProperties, state)
  }
  else {
    if (layout) {
      return applyLayout(page, layout, siteData, documentProperties, mergeState(state, {container: layout}))
    }
    else {
      return doRenderPage(page, siteData, documentProperties, state)
    }
  }
}

const renderArticle = (path, siteData) => {
  const relPath = path.replace(/^src\//, "")
  const article = siteData.articles.find(article => article.path == relPath)

  if (article === undefined) {
    console.log(`Article '${relPath}' is not found.`)
    return
  }

  const mainSection =
    typeof article.frontMatter.main === "object" ? article.frontMatter.main : {}

  if (mainSection["embedded-only"] === true) return

  const state = {path, container: undefined, innerContent: [], inserts: []}
  const wrapper = getWrapper(siteData, article.path)
  const layout = getLayout(siteData, article, wrapper)
  const documentProperties = getDocumentProperties(article, wrapper, layout, siteData.properties)

  documentProperties["title"] = getTitle(documentProperties, article.dom)

  if (wrapper) {
    return applyWrapper(article, wrapper, layout, siteData, documentProperties, state)
  }
  else {
    if (layout) {
      return applyLayout(article, layout, siteData, documentProperties, mergeState(state, {container: layout}))
    }
    else {
      return doRenderPage(article, siteData, documentProperties, state)
    }
  }
}

const applyLayout = (page, layout, siteData, documentProperties, state) => {
  const doc = parseDocument("<html><head></head><body></body></html>")
  const head = renderHead(documentProperties, siteData)

  if (documentProperties.main["html-class"] !== undefined) {
    doc.children[0].attribs = {class: documentProperties.main["html-class"]}
  }

  doc.children[0].children[0].children = head.children

  const pageState = mergeState(state, {container: page})

  const pageContent =
    page.dom.children
      .map(child => renderNode(child, siteData, documentProperties, pageState))
      .flat()

  const localState =
    getLocalState(state, layout, pageContent, page.inserts)

  const rendered =
    layout.dom.children
      .map(child => renderNode(child, siteData, documentProperties, localState))
      .flat()
      .map(c => postprocess(c, {}))
      .flat()

  doc.children[0].children.pop()
  rendered.forEach(child => doc.children[0].children.push(child))

  return doc
}

const applyWrapper = (page, wrapper, layout, siteData, documentProperties, state) => {
  const doc = parseDocument("<html><head></head><body></body></html>")
  const head = renderHead(documentProperties, siteData)

  if (documentProperties.main["html-class"] !== undefined) {
    doc.children[0].attribs = {class: documentProperties.main["html-class"]}
  }

  doc.children[0].children[0].children = head.children

  const pageState = mergeState(state, {container: page})

  const pageContent =
    page.dom.children
      .map(child => renderNode(child, siteData, documentProperties, pageState))
      .flat()

  const localState = getLocalState(state, wrapper, pageContent, page.inserts)

  const renderedWrapper =
    wrapper.dom.children
      .map(child => renderNode(child, siteData, documentProperties, localState))
      .flat()

  if (layout) {
    const localState = getLocalState(state, layout, renderedWrapper)

    const rendered =
      layout.dom.children
        .map(child => renderNode(child, siteData, documentProperties, localState))
        .flat()
        .map(c => postprocess(c, {}))
        .flat()

    doc.children[0].children.pop()
    rendered.forEach(child => doc.children[0].children.push(child))

    return doc
  }
  else {
    doc.children[0].children[1].children = renderedWrapper

    return doc
  }
}

const doRenderPage = (page, siteData, documentProperties, state) => {
  const doc = parseDocument("<html><head></head><body></body></html>")
  const head = renderHead(documentProperties, siteData)

  if (documentProperties.main["html-class"] !== undefined) {
    doc.children[0].attribs = {class: documentProperties.main["html-class"]}
  }

  doc.children[0].children[0].children = head.children

  const localState = getLocalState(state, page, undefined)

  const renderedPage =
    page.dom.children
      .map(child => renderNode(child, siteData, documentProperties, localState))
      .flat()
      .map(c => postprocess(c, {}))
      .flat()

  doc.children[0].children[1].children = renderedPage

  return doc
}

const renderNode = (node, siteData, documentProperties, state) => {
  if (node == undefined) return err("undefined")

  const klass = node.constructor.name

  if (klass === "Document") {
    console.log("renderNode() does not accept a Document as the first argument.")
  }
  else if (klass === "Element") {
    if (node.name === "tg:content") {
      if (state.innerContent !== undefined) return state.innerContent
      return err(render(node))
    }
    else if (node.name === "tg:segment") {
      return renderSegment(node, siteData, documentProperties, state)
    }
    else if (node.name === "tg:component") {
      return renderComponent(node, siteData, documentProperties, state)
    }
    else if (node.name === "tg:shared-component") {
      return renderSharedComponent(node, siteData, documentProperties, state)
    }
    else if (node.name === "tg:slot") {
      return renderSlot(node, siteData, documentProperties, state)
    }
    else if (node.name === "tg:prop") {
      return renderProp(node, siteData, documentProperties, state)
    }
    else if (node.name === "tg:data") {
      return renderData(node, siteData, documentProperties, state)
    }
    else if (node.name === "tg:if-complete") {
      return renderIfComplete(node, siteData, documentProperties, state)
    }
    else if (node.name === "tg:article") {
      return renderEmbeddedArticle(node, siteData, state)
    }
    else if (node.name === "tg:articles") {
      return renderEmbeddedArticleList(node, siteData, state)
    }
    else if (node.name === "tg:if-embedded") {
      return renderIfEmbedded(node, documentProperties, siteData, state)
    }
    else if (node.name === "tg:unless-embedded") {
      return renderUnlessEmbedded(node, documentProperties, siteData, state)
    }
    else if (node.name === "tg:link") {
      return renderLink(node, documentProperties, siteData, state)
    }
    else if (node.name === "tg:links") {
      return renderLinks(node, documentProperties, siteData, state)
    }
    else if (node.name === "tg:label") {
      return renderLabel(node, state)
    }
    else if (node.name === "tg:animation") {
      return renderAnimation(node)
    }
    else if (node.name === "tg:symbol") {
      return renderSymbol(node)
    }
    else if (node.name === "tg:plugin") {
      return node
    }
    else if (node.name === "tg:app") {
      return renderAppPlaceholder(node, siteData)
    }
    else if (node.name === "a") {
      return renderAnchor(node, siteData, documentProperties, state)
    }
    else {
      return renderElement(node, siteData, documentProperties, state)
    }
  }
  else {
    return node
  }
}

const renderSegment = (node, siteData, documentProperties, state) => {
  const segmentName = node.attribs.name

  if (state.referencedSegmentNames && state.referencedSegmentNames.includes(segmentName))
    return err(render(node))

  const allowedTypes = ["page", "layout", "segment", "wrapper"]

  if (state.container && allowedTypes.includes(state.container.type)) {
    const segment = siteData.segments.find(c => c.path == `segments/${segmentName}.html`)

    if (segment === undefined) console.log({notFound: segmentName})
    if (segment === undefined) return err(render(node))

    let properties = Object.assign({}, documentProperties)
    properties = mergeProperties(documentProperties, segment.frontMatter)

    Object.keys(node.attribs).forEach(key => {
      if (key.startsWith("data-")) {
        const propName = toKebabCase(key.slice(5))
        properties.data[propName] = node.attribs[key]
      }
    })

    const inserts = getInserts(node)
    const innerContent = removeInserts(node)
    const localState = getLocalState(state, segment, innerContent, inserts)

    if (localState.referencedSegmentNames) localState.referencedSegmentNames.push(segmentName)

    return segment.dom.children
      .map(child => renderNode(child, siteData, properties, localState))
      .flat()
  }
  else {
    return err(render(node))
  }
}

const renderComponent = (node, siteData, documentProperties, state) => {
  const componentName = node.attribs.name

  if (state.referencedComponentNames && state.referencedComponentNames.includes(componentName))
    return err(render(node))

  if (state.referencedComponentNames &&
      state.referencedComponentNames.some(name => name.startsWith("shared_components/")))
    return err(render(node))

  const component = siteData.components.find(c => c.path == `components/${componentName}.html`)

  if (component === undefined) return err(render(node))

  let properties = Object.assign({}, documentProperties)
  properties = mergeProperties(documentProperties, component.frontMatter)

  if (properties.data === undefined) properties.data = {}

  Object.keys(node.attribs).forEach(key => {
    if (key.startsWith("data-")) {
      const propName = toKebabCase(key.slice(5))
      properties.data[propName] = node.attribs[key]
    }
  })

  const inserts = getInserts(node)
  const innerContent = removeInserts(node)
  const localState = getLocalState(state, component, innerContent, inserts)

  if (localState.referencedComponentNames) localState.referencedComponentNames.push(componentName)

  return component.dom.children
    .map(child => renderNode(child, siteData, properties, localState))
    .flat()
}

const renderSharedComponent = (node, siteData, documentProperties, state) => {
  const componentName = "shared_components/" + node.attribs.name

  if (state.referencedComponentNames && state.referencedComponentNames.includes(componentName))
    return err(render(node))

  const component =
    siteData.sharedComponents.find(c => c.path == `${componentName}.html`)

  if (component === undefined) return err(render(node))

  let properties = Object.assign({}, documentProperties)
  properties = mergeProperties(documentProperties, component.frontMatter)

  if (properties.data === undefined) properties.data = {}

  Object.keys(node.attribs).forEach(key => {
    if (key.startsWith("data-")) {
      const propName = toKebabCase(key.slice(5))
      properties.data[propName] = node.attribs[key]
    }
  })

  const inserts = getInserts(node)
  const innerContent = removeInserts(node)
  const localState = getLocalState(state, component, innerContent, inserts)

  if (localState.referencedComponentNames) localState.referencedComponentNames.push(componentName)

  return component.dom.children
    .map(child => renderNode(child, siteData, properties, localState))
    .flat()
}

const getInserts = (node) => {
  const inserts = {}

  node.children
    .filter(child => child.constructor.name === "Element" && child.name === "tg:insert")
    .forEach(child => {
      const name = child.attribs.name

      if (name) inserts[name] = child
    })

  return inserts
}

const removeInserts = (node) =>
  node.children.filter(child =>
    child.constructor.name !== "Element" || child.name !== "tg:insert"
  )

const renderSlot = (node, siteData, documentProperties, state) => {
  const insert = state.inserts && state.inserts[node.attribs.name] || node

  return insert.children
          .map(child => renderNode(child, siteData, documentProperties, state))
          .flat()
}

const renderProp = (node, siteData, documentProperties, state) => {
  const value = documentProperties.main[node.attribs.name]

  if (value) {
    const textNode = parseDocument("\n").children[0]
    textNode.data = escape(value)
    return textNode
  }
  else {
    return node.children
            .map(child => renderNode(child, siteData, documentProperties, state))
            .flat()
  }
}

const renderData = (node, siteData, documentProperties, state) => {
  if (typeof documentProperties.data !== "object") return node

  const value = documentProperties.data[node.attribs.name]

  if (value) {
    const textNode = parseDocument("\n").children[0]

    if (value.constructor.name === "LocalDate") {
      const str = value + ""
      const parts = str.match(/(\d{4})(\d{2})(\d{2})/)
      textNode.data = parts.slice(1).join("-")
    }
    else if (value.constructor.name === "OffsetDateTime") {
      const dt_value = parseInt(value + "")
      const dt = new Date(dt_value)
      textNode.data = dt.toISOString()
    }
    else if (value.constructor.name === "LocalTime") {
      const str = value + ""
      const parts = str.match(/(\d{2})(\d{2})(\d{2})/)
      textNode.data = parts.slice(1).join(":")
    }
    else {
      textNode.data = escape(value)
    }

    return textNode
  }
  else {
    return node.children
            .map(child => renderNode(child, siteData, documentProperties, state))
            .flat()
  }
}

const renderIfComplete = (node, siteData, documentProperties, state) => {
  const placeholders =
    DomUtils.find(n => {
      if (n.constructor.name === "Element") {
        if (n.name === "tg:prep") return true
        if (n.name === "tg:data") return true
        if (n.name === "tg:slot") return true
        return false
      }
    }, node.children, true)

  if (placeholders.every(p => {
    if (p.name === "tg:prep") return documentProperties[p.attribs.name] !== undefined
    if (p.name === "tg:data" && documentProperties.data === undefined) return false
    if (p.name === "tg:data") return documentProperties.data[p.attribs.name] !== undefined
    if (p.name === "tg:slot") return state.inserts[p.attribs.name] !== undefined
    return false
  })) {
    return node.children
        .map(child => renderNode(child, siteData, documentProperties, state))
        .flat()
  }
  else {
    return []
  }
}

const renderEmbeddedArticle = (node, siteData, state) => {
  const articleName = node.attribs.name

  if (state.container && (
      state.container.type === "page" ||
      state.container.type === "segment" ||
      state.container.type === "wrapper" ||
      state.container.type === "layout")) {
    const article = siteData.articles.find(a => a.path == `articles/${articleName}.html`)

    if (article === undefined) return err(render(node))

    if (siteData.options.buildDrafts !== true && article.frontMatter.main &&
      article.frontMatter.main.draft === true) return []

    return doRenderEmbeddedArticle(article, node, siteData, state)
  }
  else {
    return err(render(node))
  }
}

const renderEmbeddedArticleList = (node, siteData, state) => {
  const pattern = node.attribs.pattern
  const tag = getTag(node.attribs.filter)
  const orderBy = node.attribs["order-by"]

  if (state.container && (
      state.container.type === "page" ||
      state.container.type === "segment" ||
      state.container.type === "wrapper" ||
      state.container.type === "layout")) {
    let articles = filterArticles(siteData.articles, pattern, tag)
    sortArticles(articles, orderBy)

    if (siteData.options.buildDrafts !== true) {
      articles =
        articles.filter(a =>
          a.frontMatter.main === undefined || a.frontMatter.main.draft !== true
        )
    }

    return articles.map(article => doRenderEmbeddedArticle(article, node, siteData, state)).flat()
  }
  else {
    return err(render(node))
  }
}

const doRenderEmbeddedArticle = (article, parent, siteData, state) => {
  const inserts = getInserts(parent)
  const innerContent = removeInserts(parent)
  const localState = getLocalState(state, article, innerContent, inserts)

  const wrapper = getWrapper(siteData, article.path)
  const properties = getDocumentProperties(article, wrapper, undefined, siteData.properties)

  Object.keys(parent.attribs).forEach(key => {
    if (key.startsWith("data-")) {
      const propName = toKebabCase(key.slice(5))
      properties.data[propName] = parent.attribs[key]
    }
  })

  const articleContent =
    article.dom.children
      .map(child => renderNode(child, siteData, properties, localState))
      .flat()

  state.itemIndex = localState.itemIndex

  if (wrapper) {
    const localState2 = getLocalState(state, wrapper, articleContent, article.inserts)

    const content =
      wrapper.dom.children
        .map(child => renderNode(child, siteData, properties, localState2))
        .flat()

    state.itemIndex = localState2.itemIndex

    return content
  }
  else {
    return articleContent
  }
}

const renderIfEmbedded = (node, properties, siteData, state) => {
  if (state.container.path.startsWith("articles")) {
    if (state.path.startsWith("src/articles/")) {
      return []
    }
    else {
      return node.children
        .map(child => renderNode(child, siteData, properties, state))
        .flat()
    }
  }
  else {
    return err(render(node))
  }
}

const renderUnlessEmbedded = (node, properties, siteData, state) => {
  if (state.container.path.startsWith("articles")) {
    if (state.path.startsWith("src/articles/")) {
      return node.children
        .map(child => renderNode(child, siteData, properties, state))
        .flat()
    }
    else {
      return []
    }
  }
  else {
    return err(render(node))
  }
}

const renderLink = (node, properties, siteData, state) => {
  const localState =
    mergeState(state, {container: node, targetPath: node.attribs.href, label: node.attribs.label})

  let targetPath = localState.targetPath

  if (targetPath.startsWith("/articles/")) {
    const article = siteData.articles.find(a => `/${a.path}` === targetPath)

    if (siteData.options.buildDrafts !== true && article && article.frontMatter.main &&
      article.frontMatter.main.draft === true) return []
  }
  else {
    targetPath = targetPath === "/" ? "index.html" : targetPath
    const page = siteData.pages.find(p => `/${p.path}` === targetPath)

    if (siteData.options.buildDrafts !== true && page && page.frontMatter.main &&
      page.frontMatter.main.draft === true) return []
  }

  let children

  if (node.attribs.component !== undefined) {
    const component =
      siteData.components.find(c => c.path === `components/${node.attribs.component}.html`)

    if (component) {
      children = component.dom.children
    }
    else {
      children = node.children
    }
  }
  else if (node.attribs.sharedComponent !== undefined) {
    const component =
      siteData.sharedComponents.find(c =>
        c.path == `shared_components/${node.attribs.component}.html`
      )

    if (component) {
      children = component.dom.children
    }
    else {
      children = node.children
    }
  }
  else {
    children = node.children
  }

  const href = state.path.replace(/^src\//, "").replace(/^pages/, "").replace(/\bindex.html$/, "")

  if (localState.targetPath === href) {
    const fallback =
      DomUtils.findOne(
        n => n.constructor.name === "Element" && n.name === "tg:if-current",
        children,
        true
      )

    if (fallback)
      return fallback.children
        .map(child => renderNode(child, siteData, properties, localState))
        .flat()
    else
      return []
  }
  else {
    return children.map(child => {
      if (child.constructor.name === "Element" && child.name === "tg:if-current") return []
      return renderNode(child, siteData, properties, localState)
    })
    .flat()
  }
}

const renderLinks = (node, documentProperties, siteData, state) => {
  const pattern = node.attribs.pattern
  const tag = getTag(node.attribs.filter)
  const orderBy = node.attribs["order-by"]

  if (state.container && (state.container.type !== "links")) {
    let articles = filterArticles(siteData.articles, pattern, tag)

    if (orderBy !== undefined) sortArticles(articles, orderBy)

    if (siteData.options.buildDrafts !== true) {
      articles =
        articles.filter(a =>
          a.frontMatter.main === undefined || a.frontMatter.main.draft !== true
        )
    }

    return articles
      .map(article => renderArticleLink(node, article, siteData, state))
      .flat()
      .filter(node => !Array.isArray(node))
  }
  else {
    return err(render(node))
  }
}

const renderArticleLink = (node, article, siteData, state) => {
  const href = `/${article.path}`.replace(/\/index.html$/, "/")
  const localState = mergeState(state, {targetPath: href, inserts: article.inserts})

  let children

  if (node.attribs.component !== undefined) {
    const component =
      siteData.components.find(c => c.path === `components/${node.attribs.component}.html`)

    if (component) {
      children = component.dom.children
    }
    else {
      children = node.children
    }
  }
  else if (node.attribs.sharedComponent !== undefined) {
    const component =
      siteData.sharedComponents.find(c =>
        c.path === `shared_components/${node.attribs.component}.html`
      )

    if (component) {
      children = component.dom.children
    }
    else {
      children = node.children
    }
  }
  else {
    children = node.children
  }

  if (`src/${article.path}` === state.path) {
    const fallback =
      DomUtils.findOne(
        n => n.constructor.name === "Element" && n.name === "tg:if-current",
        children,
        true
      )

    if (fallback)
      return fallback.children
        .map(child => renderNode(child, siteData, article.frontMatter, localState))
        .flat()
    else
      return []
  }
  else {
    return children.map(child => {
      if (child.constructor.name === "Element" && child.name === "tg:if-current") return []
      return renderNode(child, siteData, article.frontMatter, localState)
    })
  }
}

const renderLabel = (node, state) => {
  if (state.container.name === "tg:link" || state.container.name === "tg:links") {
    if (state.label !== "") {
      const textNode = parseDocument("\n").children[0]
      textNode.data = escape(state.label)
      return textNode
    }
  }
  else {
    return err(render(node))
  }
}

const renderAnimation = (node) => {
  const canvas = parseDocument(`<canvas data-animation="lottie"></canvas>`).children[0]

  if (node.attribs["src"] && node.attribs["src"] !== "") {
    canvas.attribs["data-src"] = node.attribs["src"]

    if (["false", "true"].includes(node.attribs["autoplay"]))
      canvas.attribs["data-autoplay"] = node.attribs["autoplay"]

    if (["false", "true"].includes(node.attribs["loop"]))
      canvas.attribs["data-loop"] = node.attribs["loop"]

    if (["false", "true"].includes(node.attribs["hover"]))
      canvas.attribs["data-hover"] = node.attribs["hover"]

    if (["false", "true"].includes(node.attribs["click"]))
      canvas.attribs["data-click"] = node.attribs["click"]

    if (node.attribs["class"]) canvas.attribs["class"] = node.attribs["class"]
    if (node.attribs["width"]) canvas.attribs["width"] = node.attribs["width"]
    if (node.attribs["height"]) canvas.attribs["height"] = node.attribs["height"]

    return canvas
  }
  else {
    return err(render(node))
  }
}

const renderSymbol = (node) => {
  const name = node.attribs["name"]
  const codepoint = symbolNameCodepointMapping[name]

  if (codepoint) {
    const symbolStyle = node.attribs["symbol-style"] || "outlined"

    const span = parseDocument(`<span>&#x${codepoint};</span>`).children[0]
    const classTokens = []

    const styleNameParts = symbolStyle.split("-")

    if (styleNameParts.length === 1) {
      classTokens.push(`material-symbols-${symbolStyle}`)
    }
    else {
      const styleName = styleNameParts[0]
      const variant = styleNameParts.slice(1).join("-")
      classTokens.push(`material-symbols-${styleName}`)
      classTokens.push(`material-symbols-${styleName}-${variant}`)
    }

    span.attribs["class"] = classTokens.join(" ")

    const settings = []

    if (["0", "1"].includes(node.attribs["fill"])) settings.push(`'FILL' ${node.attribs["fill"]}`)

    if (["100", "200", "300", "400", "500", "600", "700"].includes(node.attribs["wght"]))
      settings.push(`'wght' ${node.attribs["wght"]}`)

    if (["-25", "0", "200"].includes(node.attribs["grad"]))
      settings.push(`'GRAD' ${node.attribs["grad"]}`)

    if (["20", "24", "40", "48"].includes(node.attribs["opsz"]))
      settings.push(`'opsz' ${node.attribs["opsz"]}`)

    if (settings.length > 0) {
      span.attribs["style"] = `font-variation-settings: ${settings.join(", ")}`
    }

    return span
  }
  else {
    return err(render(node))
  }
}

const renderAppPlaceholder = (node, siteData) => {
  const appName = node.attribs.name

  if (appName && Array.isArray(siteData.properties.apps)) {
    const appConfig = siteData.properties.apps.find(app => app.name === appName)

    if (appConfig) {
      const displayName = appConfig["display-name"] || appName
      const outerNode = parseDocument(`<div></div>`).children[0]
      const innerNode = parseDocument(`<div>${displayName}</div>`).children[0]

      outerNode.attribs = {
        style: `width: 100%; height: 300px; padding: 16px; backdrop-filter: invert(50%);`
      }

      innerNode.attribs = {
        style:
          "width: 100%; height: 100%; background-color: white; opacity: 50%; " +
          "display: flex; justify-content: center; align-items: center; font-size: 1.5rem;"
      }

      outerNode.children = [innerNode]
      return outerNode
    }
    else {
      return err(render(node))
    }
  }
  else {
    return err(render(node))
  }
}

const renderAnchor = (node, siteData, documentProperties, state) => {
  if (node.attribs.href === "#" && state.targetPath !== undefined) {
    const newNode = parseDocument("<a></a>").children[0]
    newNode.attribs = Object.assign({}, node.attribs)
    newNode.attribs.href = state.targetPath

    newNode.children =
      node.children
        .map(child => renderNode(child, siteData, documentProperties, state))
        .flat()

    return newNode
  }
  else {
    return renderElement(node, siteData, documentProperties, state)
  }
}

const renderElement = (node, siteData, documentProperties, state) => {
  const newNode = parseDocument("<div></div>").children[0]
  const newState = mergeState(state, {})

  newNode.name = node.name
  newNode.attribs = Object.assign({}, node.attribs)
  convertAttribs(newNode.attribs, documentProperties)
  purgeAttribs(newNode.attribs)

  if (newNode.attribs["tg:toggler"] !== undefined && state.hookName === undefined)
    addTogglerHook(newNode, newState)

  if (newNode.attribs["tg:switcher"] !== undefined && state.hookName === undefined)
    addSwitcherHook(node, newNode, newState)

  if (newNode.attribs["tg:rotator"] !== undefined && state.hookName === undefined)
    addRotatorHook(node, newNode, newState)

  if (newNode.attribs["tg:carousel"] !== undefined && state.hookName === undefined)
    addCarouselHook(node, newNode, newState)

  if (newNode.attribs["tg:modal"] !== undefined && state.hookName === undefined)
    addModalHook(newNode, newState)

  if (newNode.attribs["tg:scheduler"] !== undefined && state.hookName === undefined)
    addSchedulerHook(newNode, newState)

  if (newNode.attribs["tg:tram"] !== undefined && state.hookName === undefined)
    addTramHook(newNode, newState)

  if (state.hookName === "toggler") addTogglerSubhooks(newNode)
  else if (state.hookName === "switcher") addSwitcherSubhooks(newNode, state)
  else if (state.hookName === "rotator") addRotatorSubhooks(newNode, state)
  else if (state.hookName === "carousel") addCarouselSubhooks(newNode)
  else if (state.hookName === "modal") addModalSubhooks(newNode)
  else if (state.hookName === "tram") addTramSubhooks(newNode)

  newNode.children =
    node.children
      .map(child => renderNode(child, siteData, documentProperties, newState))
      .flat()

  return newNode
}

const convertAttribs = (attribs, documentProperties) => {
  Object.keys(attribs).forEach(key => {
    attribs[key] = expandCustomProperties(attribs[key], documentProperties)
  })
}

const expandCustomProperties = (value, documentProperties) =>
  value.replaceAll(/\$\{(\w+(?:-\w+)*)\}/g, (_, propName) => {
    if (documentProperties.data === undefined) return `\${${propName}}`
    else if (documentProperties.data[propName] !== undefined)
      return documentProperties.data[propName]
    else return `\${${propName}}`
  })

// Toggler

const addTogglerHook = (newNode, newState) => {
  newNode.attribs["x-data"] = `{ f: false }`
  newNode.attribs["x-on:click"] = `f = false`
  newNode.attribs["x-on:click.outside"] = `f = false`
  newState.hookName = "toggler"
}

const addTogglerSubhooks = (newNode) => {
  const enebledClass = (newNode.attribs["tg:enabled-class"] || "").replace(/'/, "\\'")
  const disabledClass = (newNode.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")

  if (newNode.attribs["tg:when"] === "on") {
    newNode.attribs["x-show"] = `f === true`
    newNode.attribs["x-cloak"] = `x-cloak`
  }
  else if (newNode.attribs["tg:when"] === "off") newNode.attribs["x-show"] = `f === false`

  if (newNode.attribs["tg:toggle"] === "on") {
    newNode.attribs["x-on:click.stop"] = "f = true"
    newNode.attribs["x-bind:class"] = `f === true ? '${disabledClass}' : '${enebledClass}'`
  }
  else if (newNode.attribs["tg:toggle"] === "off") {
    newNode.attribs["x-on:click.stop"] = "f = false"
    newNode.attribs["x-bind:class"] = `f === false ? '${disabledClass}' : '${enebledClass}'`
  }
  else if (newNode.attribs["tg:toggle"] === "") {
    newNode.attribs["x-on:click.stop"] = "f = !f"
    newNode.attribs["x-bind:class"] = `'${enebledClass}'`
  }
}

// Switcher

const addSwitcherHook = (node, newNode, newState) => {
  newState.hookName = "switcher"
  newState.itemIndex = 0

  let transitionDuration

  if (newNode.attribs["tg:transition-duration"] !== undefined) {
    transitionDuration = parseInt(newNode.attribs["tg:transition-duration"], 10)
  }

  if (! Number.isNaN(transitionDuration)) {
    newState.transitionDuration = transitionDuration
  }
  else {
    newState.transitionDuration = 0
  }
}

const addSwitcherSubhooks = (newNode, state) => {
  const enebledClass = (newNode.attribs["tg:enabled-class"] || "").replace(/'/, "\\'")
  const disabledClass = (newNode.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")
  const currentClass = (newNode.attribs["tg:current-class"] || "").replace(/'/, "\\'")
  const normalClass = (newNode.attribs["tg:normal-class"] || "").replace(/'/, "\\'")

  if (newNode.attribs["tg:body"] !== undefined) {
    newNode.attribs["data-switcher-body"] = ""
  }
  else if (newNode.attribs["tg:item"] !== undefined) {
    newNode.attribs["data-item-index"] = String(state.itemIndex)
    addTransitionEffect(newNode, state)
    state.itemIndex = state.itemIndex + 1
  }

  if (newNode.attribs["tg:first"] !== undefined) {
    newNode.attribs["x-on:click"] = "first()"
    newNode.attribs["x-bind:class"] = `i === 0 ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:prev"] !== undefined) {
    newNode.attribs["x-on:click"] = "prev()"
    newNode.attribs["x-bind:class"] = `i === 0 ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:next"] !== undefined) {
    newNode.attribs["x-on:click"] = "next()"
    newNode.attribs["x-bind:class"] = `i === len - 1 ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:last"] !== undefined) {
    newNode.attribs["x-on:click"] = "last()"
    newNode.attribs["x-bind:class"] = `i === len - 1 ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:choose"] !== undefined) {
    const n = parseInt(newNode.attribs["tg:choose"], 10)

    if (!Number.isNaN(n)) {
      newNode.attribs["x-on:click"] = `choose(${n})`
      newNode.attribs["x-bind:class"] = `i == ${n} ? '${currentClass}' : '${normalClass}'`
    }
  }
}

// Rotator

const addRotatorHook = (node, newNode, newState) => {
  newState.hookName = "rotator"
  newState.itemIndex = 0

  let transitionDuration

  if (newNode.attribs["tg:transition-duration"] !== undefined) {
    transitionDuration = parseInt(newNode.attribs["tg:transition-duration"], 10)
  }

  if (! Number.isNaN(transitionDuration)) {
    newState.transitionDuration = transitionDuration
  }
  else {
    newState.transitionDuration = 0
  }
}

const addRotatorSubhooks = (newNode, state) => {
  const enebledClass = (newNode.attribs["tg:enabled-class"] || "").replace(/'/, "\\'")
  const disabledClass = (newNode.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")
  const currentClass = (newNode.attribs["tg:current-class"] || "").replace(/'/, "\\'")
  const normalClass = (newNode.attribs["tg:normal-class"] || "").replace(/'/, "\\'")

  if (newNode.attribs["tg:body"] !== undefined) {
    newNode.attribs["data-rotator-body"] = ""
  }
  else if (newNode.attribs["tg:item"] !== undefined) {
    newNode.attribs["data-item-index"] = String(state.itemIndex)
    addTransitionEffect(newNode, state)
    state.itemIndex = state.itemIndex + 1
  }

  if (newNode.attribs["tg:first"] !== undefined) {
    newNode.attribs["x-on:click"] = "first()"
    newNode.attribs["x-bind:class"] = `i === 0 ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:prev"] !== undefined) {
    newNode.attribs["x-on:click"] = "prev()"
    newNode.attribs["x-bind:class"] = `'${enebledClass}'`
  }

  if (newNode.attribs["tg:next"] !== undefined) {
    newNode.attribs["x-on:click"] = "next()"
    newNode.attribs["x-bind:class"] = `'${enebledClass}'`
  }

  if (newNode.attribs["tg:last"] !== undefined) {
    newNode.attribs["x-on:click"] = "last()"
    newNode.attribs["x-bind:class"] = `i === len - 1 ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:choose"] !== undefined) {
    const n = parseInt(newNode.attribs["tg:choose"], 10)

    if (!Number.isNaN(n)) {
      newNode.attribs["x-on:click"] = `choose(${n})`
      newNode.attribs["x-bind:class"] = `i == ${n} ? '${currentClass}' : '${normalClass}'`
    }
  }
}

const addTransitionEffect = (newNode, state) => {
  if (state.transitionDuration !== undefined) {
    const transitionStyle = `transition: opacity ${state.transitionDuration}ms`
    const style00 = `position: absolute; opacity: 1; order: 0`
    const style01 = `position: absolute; opacity: 0; order: -1`
    const style10 = `position: absolute; opacity: 1; order: 0; ${transitionStyle}`
    const style11 = `position: absolute; opacity: 0; order: -1; ${transitionStyle}`
    const expr0 = `($el.dataset.itemIndex === String(i) ? '${style00}' : '${style01}')`
    const expr1 = `($el.dataset.itemIndex === String(i) ? '${style10}' : '${style11}')`
    newNode.attribs["x-bind:style"] = `initial ? ${expr0} : ${expr1}`
  }
  else {
    newNode.attribs["x-show"] = `$el.dataset.itemIndex === String(i)`
  }
}

// Carousel

const addCarouselHook = (node, newNode, newState) => {
  newState.hookName = "carousel"
}

const addCarouselSubhooks = (newNode) => {
  const enebledClass = (newNode.attribs["tg:enabled-class"] || "").replace(/'/, "\\'")
  const disabledClass = (newNode.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")
  const currentClass = (newNode.attribs["tg:current-class"] || "").replace(/'/, "\\'")
  const normalClass = (newNode.attribs["tg:normal-class"] || "").replace(/'/, "\\'")

  if (newNode.attribs["tg:frame"] !== undefined) {
    newNode.attribs["data-carousel-frame"] = ""
  }
  else if (newNode.attribs["tg:body"] !== undefined) {
    newNode.attribs["data-carousel-body"] = ""
  }
  else if (newNode.attribs["tg:item"] !== undefined) {
    newNode.attribs["data-carousel-item"] = ""
  }

  if (newNode.attribs["tg:prev"] !== undefined) {
    newNode.attribs["x-on:click"] = "prev()"
    newNode.attribs["x-bind:class"] = `inTransition ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:next"] !== undefined) {
    newNode.attribs["x-on:click"] = "next()"
    newNode.attribs["x-bind:class"] = `inTransition ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:choose"] !== undefined) {
    const n = parseInt(newNode.attribs["tg:choose"], 10)

    if (!Number.isNaN(n)) {
      newNode.attribs["x-on:click"] = `choose(${n})`

      const script = `
          i % len === ${n} ?
            '${currentClass}' :
            (inTransition ? '${disabledClass}' : '${normalClass}')
        `

      newNode.attribs["x-bind:class"] = script.trim().replaceAll(/\s+/g, " ")
    }
  }
}

// Modal

const addModalHook = (newNode, newState) => {
  newNode.attribs["x-data"] = "{ body: undefined, open: false }"
  newNode.attribs["x-init"] = "body = $el.querySelector('dialog')"
  newState.hookName = "modal"

  if (newNode.attribs["tg:open"] !== undefined) {
    newNode.attribs["x-on:click.stop"] = "if (body && !open) body.showModal(); open = true"
  }
}

const addModalSubhooks = (newNode) => {
  if (newNode.attribs["tg:open"] !== undefined) {
    newNode.attribs["x-on:click.stop"] = "if (body && !open) body.showModal(); open = true"
  }
  else if (newNode.attribs["tg:close"] !== undefined) {
    newNode.attribs["x-on:click.stop"] = "if (body && open) body.close(); open = false"
  }
}

// Scheduler

const addSchedulerHook = (newNode, newState) => {
  newState.hookName = "scheduler"
  newNode.attribs["x-data"] = `window.tgweb.scheduler($el)`
  addSchedulerSubhooks(newNode)
}

const addSchedulerSubhooks = (newNode) => {
  if (newNode.attribs["tg:init"] !== undefined)
    newNode.attribs["data-scheduler-init"] = newNode.attribs["tg:init"]

  Object.keys(newNode.attribs).forEach(attrName => {
    const md = attrName.match(/^tg:(\d+)$/)
    if (md === null) return
    const time = md[1]

    newNode.attribs[`data-scheduler-${time}`] = newNode.attribs[attrName]
  })
}

// Tram

const addTramHook = (newNode, newState) => {
  newState.hookName = "tram"
  newNode.attribs["x-data"] = `window.tgweb.tram($el)`
  addTramSubhooks(newNode)
}

const addTramSubhooks = (newNode) => {
  if (newNode.attribs["class"] !== undefined)
    newNode.attribs["data-tram-base-class"] = newNode.attribs["class"]
  else
    newNode.attribs["data-tram-base-class"] = ""

  let classTokens = []

  if (newNode.attribs["class"] !== undefined)
    classTokens = newNode.attribs["class"].split(" ")

  if (newNode.attribs["tg:init"] !== undefined)
    classTokens = classTokens.concat(newNode.attribs["tg:init"].split(" "))

  if (classTokens.length > 0) newNode.attribs["class"] = classTokens.join(" ")

  const found =
    Object.keys(newNode.attribs).some(attrName =>
      attrName.startsWith("tg:forward-") || attrName.startsWith("tg:backward-")
    )

  if (!found) return

  newNode.attribs["data-tram-trigger"] = ""

  Object.keys(newNode.attribs).forEach(attrName => {
    const md = attrName.match(/^tg:(forward|backward)-(\d{1,3})(|%|vh|px)(|\+|-)$/)
    if (md === null) return
    const direction = md[1]
    const distance = parseInt(md[2], 10)
    const unit = md[3]
    const suffix = md[4]

    newNode.attribs[`data-tram-${direction}-${distance}${unit}${suffix}`] =
      newNode.attribs[attrName]
  })
}

// Postprocess

const postprocess = (node, state) => {
  const newState = Object.assign({}, state)
  const klass = node.constructor.name

  if (klass === "Element") {
    if (node.attribs["tg:carousel"] !== undefined) {
      newState.hookName = "carousel"
      return postprocessHook(node, newState)
    }
    else if (state.hookName === "carousel") {
      if (node.attribs["tg:body"] !== undefined)
        return postprocessCarouselBody(node, newState)
      else if (node.attribs["tg:paginator"] !== undefined)
        return postprocessPaginator(node, newState)
      else {
        node.children = node.children.map(c => postprocess(c, newState)).flat()
        removeTgAttribs(node.attribs)
        return node
      }
    }
    else if (node.attribs["tg:switcher"] !== undefined) {
      newState.hookName = "switcher"
      return postprocessHook(node, newState)
    }
    else if (node.attribs["tg:rotator"] !== undefined) {
      newState.hookName = "rotator"
      return postprocessHook(node, newState)
    }
    else if (state.hookName === "switcher" || state.hookName === "rotator") {
      if (node.attribs["tg:paginator"] !== undefined)
        return postprocessPaginator(node, newState)
      else {
        node.children = node.children.map(c => postprocess(c, newState)).flat()
        removeTgAttribs(node.attribs)
        return node
      }
    }
    else if (node.name === "tg:plugin" && node.attribs.name == "hubspot") {
      const script0 = "<script charset='utf-8' type='text/javascript' src='//js.hsforms.net/forms/embed/v2.js'></script>"
      const portalId = node.attribs["portal-id"]
      const formId = node.attribs["form-id"]
      const scriptBody = `hbspt.forms.create({portalId: "${portalId}", formId: "${formId}"});`
      return parseDocument(`${script0}<script>${scriptBody}</script>`)
    }
    else {
      node.children = node.children.map(c => postprocess(c, newState)).flat()
      removeTgAttribs(node.attribs)
      return node
    }
  }
  else {
    return node
  }
}

const postprocessHook = (node, newState) => {
  const items =
    DomUtils.findAll(elem => elem.attribs["tg:item"] !== undefined, node.children)

  let interval = 0

  if (node.attribs["tg:interval"] !== undefined) {
    interval = parseInt(node.attribs["tg:interval"], 10)
    if (Number.isNaN(interval)) interval = 0
    if (interval < 0) interval = 0
  }

  let transitionDuration = parseInt(node.attribs["tg:transition-duration"], 10)
  if (Number.isNaN(transitionDuration)) transitionDuration = 0

  newState.itemCount = items.length

  if (newState.hookName === "carousel") {
    newState.repeatCount = 3

    node.attribs["x-data"] =
      `window.tgweb.carousel($el, ${items.length}, ${newState.repeatCount}, ${interval}, ${transitionDuration})`
  }
  else {
    node.attribs["x-data"] =
      `window.tgweb.${newState.hookName}($el, ${interval}, ${transitionDuration})`
  }

  node.children = node.children.map(c => postprocess(c, newState)).flat()
  removeTgAttribs(node.attribs)
  return node
}

const postprocessCarouselBody = (node, newState) => {
  const carouselItems =
    DomUtils.findAll(elem => elem.attribs["tg:item"] !== undefined, node.children)

  const children = []

  for (let n = 0; n < newState.repeatCount; n++) {
    carouselItems.forEach(item => {
      children.push(item.cloneNode(true))
    })
  }

  node.children = children
  return node
}

const postprocessPaginator = (node, newState) => {
  const disabledClass = (node.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")
  const currentClass = (node.attribs["tg:current-class"] || "").replace(/'/, "\\'")
  const normalClass = (node.attribs["tg:normal-class"] || "").replace(/'/, "\\'")
  const choosers = []

  removeTgAttribs(node.attribs)

  for (let n = 0; n < newState.itemCount; n++) {
    const newNode = parseDocument("<div></div>").children[0]
    newNode.name = node.name
    newNode.children = node.children
    newNode.attribs = Object.assign({}, node.attribs)
    newNode.attribs["x-on:click"] = `choose(${n})`

    const script = `
        i % len === ${n} ?
          '${currentClass}' :
          (inTransition ? '${disabledClass}' : '${normalClass}')
      `

    newNode.attribs["x-bind:class"] = script.trim().replaceAll(/\s+/g, " ")

    delete newNode.attribs.id
    choosers.push(newNode)
  }

  return choosers
}

const purgeAttribs = (attribs) => {
  const keys = Object.keys(attribs).filter(key => key.match(/^(on|x-|:|@)/))
  keys.forEach(key => delete attribs[key])
}

const removeTgAttribs = (attribs) => {
  const keys = Object.keys(attribs).filter(key => key.match(/^tg:/))
  keys.forEach(key => delete attribs[key])
}

const renderHead = (documentProperties, siteData) => {
  const head = parseDocument("<head></head>")

  const children = []

  children.push(parseDocument("<meta charset='utf-8'>").children[0])

  if (documentProperties["title"] !== undefined) {
    const title = escape(documentProperties["title"])
    const doc = parseDocument(`<title>${title}</title>`)
    children.push(doc.children[0])
  }

  if (typeof documentProperties.meta === "object") {
    if (typeof documentProperties.meta.name === "object") {
      Object.keys(documentProperties.meta.name).forEach(name => {
        if (name.match(/"/) !== null) return
        const content = documentProperties.meta.name[name]

        if (typeof content === "string") {
          const doc = parseDocument(`<meta name="${name}" content="${content}">`)
          children.push(doc.children[0])
        }
        else if (Array.isArray(content)) {
          content.forEach(e => {
            const doc = parseDocument(`<meta name="${name}" content="${e}">`)
            children.push(doc.children[0])
          })
        }
      })
    }

    if (typeof documentProperties.meta["http-equiv"] === "object") {
      Object.keys(documentProperties.meta["http-equiv"]).forEach(name => {
        if (name.match(/"/) !== null) return
        const content = documentProperties.meta["http-equiv"][name]
        if (typeof content !== "string") return

        const doc = parseDocument(`<meta http-equiv="${name}" content="${content}">`)
        children.push(doc.children[0])
      })
    }

    if (typeof documentProperties.meta["property"] === "object") {
      Object.keys(documentProperties.meta["property"]).forEach(name => {
        if (name.match(/"/) !== null) return
        const content = documentProperties.meta["property"][name]

        if (typeof content !== "string") return

        let converted = content.replaceAll(/\$\{([^}]+)\}/g, (_, propName) => {
          const parts = propName.split(".")

          if (parts.length === 1) {
            const value = documentProperties.main[propName]

            if (typeof value === "string") {
              return value
            }
            else {
              return `\${${propName}}`
            }
          }
          else if (parts.length === 2) {
            const p1 = parts[0]
            const p2 = parts[1]

            if (typeof documentProperties.main[p1] === "object") {
              const value = documentProperties.main[p1][p2]

              if (typeof value === "string") {
                return value
              }
              else {
                return `\${${propName}}`
              }
            }
            else {
              return `\${${propName}}`
            }
          }
          else if (parts.length === 3) {
            const p1 = parts[0]
            const p2 = parts[1]
            const p3 = parts[2]

            if (typeof documentProperties[p1] === "object"
              && typeof documentProperties[p1][p2] === "object") {
              const value = documentProperties[p1][p2][p3]

              if (typeof value === "string") {
                return value
              }
              else {
                return `\${${propName}}`
              }
            }
            else {
              return `\${${propName}}`
            }
          }
        })

        converted = converted.replaceAll(/%\{([^}]+)\}/g, (_, path) => {
          const rootUrl = documentProperties.main["root-url"]
          return rootUrl + path.replace(/^\//, "")
        }).replace(/"/g, "&#34")

        const doc = parseDocument(`<meta property="${name}" content="${converted}">`)
        children.push(doc.children[0])
      })
    }
  }

  if (typeof documentProperties.link === "object") {
    Object.keys(documentProperties.link).forEach(rel => {
      if (rel == "stylesheet") return
      if (rel.match(/^[a-z]+$/) === null) return

      const href = documentProperties.link[rel]

      const converted = href.replaceAll(/%\{([^}]+)\}/g, (_, path) => {
        const rootUrl = documentProperties.main["root-url"]
        return rootUrl + path.replace(/^\//, "")
      }).replace(/"/g, "&#34")

      const doc = parseDocument(`<link rel="${rel}" href="${converted}">`)
      children.push(doc.children[0])
    })
  }

  if (Array.isArray(documentProperties.links)) {
    documentProperties.links.forEach(link => {
      if (typeof link === "object") {
        const attrs =
          Object.keys(link).filter(key =>
            key.match(/^[a-z]+$/) !== null && typeof link[key] === "string"
          ).map(key => {
            const value = link[key].replace(/"/g, "&#34")
            return `${key}="${value}"`
          }).join(" ")

        const doc = parseDocument(`<link ${attrs}>`)
        children.push(doc.children[0])
      }
    })
  }

  if (typeof documentProperties.font === "object") {
    let params1 = []
    let params2 = []

    if (typeof documentProperties.font["material-symbols"] === "object") {
      const materialSymbols = documentProperties.font["material-symbols"]
      const symbolStyles = ["outlined", "rounded", "sharp"]

      const styles =
        Object.keys(materialSymbols).reduce((acc, key) => {
            const parts = key.split("-")
            let style

            if (parts.length === 1) style = key
            else if (parts.length === 2) style = parts[0]
            else style = undefined

            if (style !== undefined && !acc.includes(style) && symbolStyles.includes(style))
              acc.push(style)

            return acc
        }, [])

      params1 =
        styles.map(style => {
          const capitalized = style.charAt(0).toUpperCase() + style.slice(1)
          const params = `family=Material+Symbols+${capitalized}:opsz,wght,FILL,GRAD@`
          return params + "20..48,100..700,0..1,-50..200"
        })
    }

    const googleFonts = documentProperties.font["google-fonts"]
    const validWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900]

    if (typeof googleFonts === "object") {
      params2 =
        Object.keys(googleFonts).map(fontFamilyName => {
          const value = googleFonts[fontFamilyName]
          const escapedFontFamilyName = fontFamilyName.replaceAll(/ /g, "+")

          if (value === true) {
            return `family=${escapedFontFamilyName}`
          }
          else if (Array.isArray(value)) {
            const weights = value.filter(w => validWeights.includes(w)).join(";")
            return `family=${escapedFontFamilyName}:wght@${weights}`
          }
          else if (typeof value === "object") {
            const normalWeights =
              (Array.isArray(value.normal) ? value.normal : [])
                .filter(w => validWeights.includes(w))
                .map(w => `0,${w}`)

            const italicWeights =
              (Array.isArray(value.italic) ? value.italic : [])
                .filter(w => validWeights.includes(w))
                .map(w => `1,${w}`)

            const weights = normalWeights.concat(italicWeights).join(";")
            return `family=${escapedFontFamilyName}:ital,wght@${weights}`
          }
        })

      params2 = params2.filter((p) => p != undefined)
    }

    if (params2.length > 0 || params2.length > 0) {
      children.push(parseDocument(
        "<link rel='preconnect' href='https://fonts.googleapis.com'>").children[0])

      children.push(parseDocument(
        "<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>").children[0])
    }

    if (params1.length > 0) {
      const href = `https://fonts.googleapis.com/css2?${params1.join("&")}&display=block`
      const doc = parseDocument(`<link rel='stylesheet' href='${href}'>`)
      children.push(doc.children[0])
    }

    if (params2.length > 0) {
      const href = `https://fonts.googleapis.com/css2?${params2.join("&")}&display=swap`
      const doc = parseDocument(`<link rel='stylesheet' href='${href}'>`)
      children.push(doc.children[0])
    }

    if (typeof documentProperties.font["material-symbols"] === "object") {
      const materialSymbols = documentProperties.font["material-symbols"]

      const declarations =
        Object.keys(materialSymbols).reduce((acc, key) => {
          const value = materialSymbols[key]
          const parts = key.split("-")
          let style, variant, fill, wght, grad, opsz
          let settings, selector, declaration

          if (parts.length === 1) {
            style = key
          }
          else if (parts.length >= 2) {
            style = parts[0]
            variant = parts.slice(1).join("-")
          }
          else {
            style = undefined
          }

          if (style === undefined) return acc
          if (variant !== undefined && !variant.match(/^[0-9a-z-]+$/)) return acc

          if (value === true) {
            fill = 0
            wght = 400
            grad = 0
            opsz = 24
          }
          else if (typeof value === "object") {
            fill = value.fill
            wght = value.wght
            grad = value.grad
            opsz = value.opsz
          }

          if ([0, 1].includes(fill) && [100, 200, 300, 400, 500, 600, 700].includes(wght) &&
            [-25, 0, 200].includes(grad) && [20, 24, 40, 48].includes(opsz)) {
            if (variant === undefined) {
              settings = `"FILL" ${fill}, "wght" ${wght}, "GRAD" ${grad}, "opsz" ${opsz}`
              selector = `.material-symbols-${style}`
              declaration = `${selector} { font-variation-settings: ${settings}; }`
              acc.push(declaration)
            }
            else {
              settings = `"FILL" ${fill}, "wght" ${wght}, "GRAD" ${grad}, "opsz" ${opsz}`
              selector = `.material-symbols-${style}.material-symbols-${style}-${variant}`
              declaration = `${selector} { font-variation-settings: ${settings}; }`
              acc.push(declaration)
            }
          }

          return acc
        }, [])

      if (declarations.length > 0) {
        const styleElement = "<style>\n" + declarations.join("\n") + "</style>"
        children.push(parseDocument(styleElement).children[0])
      }
    }
  }

  children.push(parseDocument("<link rel='stylesheet' href='/css/tailwind.css'>").children[0])

  if (typeof documentProperties.stylesheets === "object") {
    for (const [key, value] of Object.entries(documentProperties.stylesheets)) {
      if (value === true) {
        children.push(parseDocument(`<link rel='stylesheet' href='/css/${key}.css'>`).children[0])
      }
    }
  }

  if (siteData.icons.includes("favicon.ico"))
    children.push(parseDocument(`<link rel='icon' href='/favicon.ico'>`).children[0])

  if (siteData.icons.includes("icon.svg"))
    children.push(parseDocument(`<link rel='icon' href='/icon.svg' type='image/svg+xml'>`).children[0])

  if (siteData.icons.includes("180.png"))
    children.push(parseDocument(`<link rel='apple-touch-icon' href='/180.png'>`).children[0])

  if (siteData.icons.includes("192.png") && siteData.icons.includes("512.png"))
    children.push(parseDocument(`<link rel='manifest' href='/manifest.webmanifest'>`).children[0])

  children.push(parseDocument("<style>[x-cloak] { display: none !important; }</style>").children[0])
  children.push(parseDocument("<script src='/js/tgweb_utilities.js' defer></script>").children[0])
  children.push(parseDocument("<script src='/js/alpine.min.js' defer></script>").children[0])
  children.push(parseDocument("<script type='module' src='/js/tgweb_lottie_player.js'></script>").children[0])

  if (siteData.forDistribution !== true)
    children.push(parseDocument("<script src='/reload/reload.js' defer></script>").children[0])

  if (typeof documentProperties.javascripts === "object") {
    for (const [key, value] of Object.entries(documentProperties.javascripts)) {
      if (value === true) {
        children.push(parseDocument(`<script src='/js/${key}.js' defer></script>'>`).children[0])
      }
    }
  }

  head.children = children

  return head
}

const getLocalState = (state, container, innerContent, inserts) => {
  const newState = {}
  newState.path = state.path
  newState.targetPath = state.targetPath
  newState.container = container
  newState.innerContent = innerContent
  newState.inserts = inserts || {}
  newState.hookName = state.hookName
  newState.itemIndex = state.itemIndex
  newState.transitionDuration = state.transitionDuration

  if (state.referencedComponentNames !== undefined)
    newState.referencedComponentNames = [...state.referencedComponentNames]

  if (state.referencedSegmentNames !== undefined)
    newState.referencedSegmentNames = [...state.referencedSegmentNames]

  return newState
}

const getTag = filter_attr => {
  if (filter_attr) {
    const re = /^(tag):(.+)$/
    const md = re.exec(filter_attr)
    if (md) return md[2]
  }
}

const mergeState = (obj1, obj2) => {
  const newState = {}
  newState.path = obj1.path
  newState.targetPath = obj1.targetPath
  newState.label = obj1.label
  newState.container = obj1.container
  newState.innerContent = obj1.innerContent
  newState.inserts = obj1.inserts
  newState.hookName = obj1.hookName
  newState.itemIndex = obj1.itemIndex
  newState.transitionDuration = obj1.transitionDuration

  if (obj1.referencedComponentNames !== undefined)
    newState.referencedComponentNames = [...obj1.referencedComponentNames]

  if (obj1.referencedSegmentNames !== undefined)
    newState.referencedSegmentNames = [...obj1.referencedSegmentNames]

  if (obj2.targetPath !== undefined) newState.targetPath = obj2.targetPath
  if (obj2.label !== undefined) newState.label = obj2.label
  if (obj2.container !== undefined) newState.container = obj2.container
  if (obj2.innerContent !== undefined) newState.innerContent = obj2.innerContent
  if (obj2.inserts !== undefined) newState.inserts = obj2.inserts
  if (obj2.hookName !== undefined) newState.hookName = obj2.hookName
  if (obj2.itemIndex !== undefined) newState.itemIndex = obj2.itemIndex
  if (obj2.transitionDuration !== undefined) newState.transitionDuration = obj2.transitionDuration

  if (obj2.referencedComponentNames !== undefined)
    newState.referencedComponentNames = [...obj2.referencedComponentNames]

  if (obj2.referencedSegmentNames !== undefined)
    newState.referencedSegmentNames = [...obj2.referencedSegmentNames]

  return newState
}

const err = (message) => {
  const escaped = escape(message)
  const div = "<span class='inline-block bg-error text-black m-1 py-1 px-2'>X</span>"
  const divNode = parseDocument(div).children[0]
  divNode.children[0].data = escaped
  return divNode
}

const toKebabCase = (str) => str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()

export { renderWebPage }
