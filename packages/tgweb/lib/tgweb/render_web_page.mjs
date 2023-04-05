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

if (inspectDom === undefined) { inspectDom() }

const renderWebPage = (path, siteData) => {
  const type = getType(path)

  if (type === "page") return renderPage(path, siteData)
  else if (type === "article") return renderArticle(path, siteData)
}

const renderPage = (path, siteData) => {
  const relPath = path.replace(/^src\//, "")
  const page = siteData.pages.find(page => page.path == relPath)

  const state =
    { path, container: undefined, innerContent: [], inserts: [], hookName: undefined }

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

  if (article.frontMatter["embedded-only"] === true) return

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
  const head = renderHead(documentProperties)

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

  doc.children[0].children.pop()
  rendered.forEach(child => doc.children[0].children.push(child))

  return doc
}

const applyWrapper = (page, wrapper, layout, siteData, documentProperties, state) => {
  const doc = parseDocument("<html><head></head><body></body></html>")
  const head = renderHead(documentProperties)

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
  const head = renderHead(documentProperties)

  doc.children[0].children[0].children = head.children

  const localState = getLocalState(state, page, undefined)

  const renderedPage =
    page.dom.children
      .map(child => renderNode(child, siteData, documentProperties, localState))
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
    else if (node.name === "tg:link") {
      return renderLink(node, documentProperties, siteData, state)
    }
    else if (node.name === "tg:links") {
      return renderLinks(node, documentProperties, siteData, state)
    }
    else if (node.name === "tg:label") {
      return renderLabel(node, state)
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

  if (state.container && (state.container.type === "page" || state.container.type === "layout")) {
    const segment = siteData.segments.find(c => c.path == `segments/${segmentName}.html`)

    if (segment === undefined) return err(render(node))

    const properties = Object.assign({}, documentProperties)

    Object.keys(node.attribs).forEach(key => {
      if (key.startsWith("data-")) {
        properties[key] = node.attribs[key]
      }
    })

    const localState = getLocalState(state, segment, node.children)

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

  const component = siteData.components.find(c => c.path == `components/${componentName}.html`)

  if (component === undefined) return err(render(node))

  const properties = Object.assign({}, documentProperties)

  if (properties.data === undefined) properties.data = {}

  Object.keys(node.attribs).forEach(key => {
    if (key.startsWith("data-")) {
      const propName = key.slice(5)
      properties.data[propName] = node.attribs[key]
    }
  })

  const inserts = {}

  node.children
    .filter(child => child.constructor.name === "Element" && child.name === "tg:insert")
    .forEach(child => {
      const name = child.attribs.name

      if (name) inserts[name] = child
    })

  const innerContent =
    node.children.filter(child =>
      child.constructor.name !== "Element" || child.name !== "tg:insert"
    )

  const localState = getLocalState(state, component, innerContent, inserts)

  return component.dom.children
    .map(child => renderNode(child, siteData, properties, localState))
    .flat()
}

const renderSlot = (node, siteData, documentProperties, state) => {
  const insert = state.inserts && state.inserts[node.attribs.name] || node

  return insert.children
          .map(child => renderNode(child, siteData, documentProperties, state))
          .flat()
}

const renderProp = (node, siteData, documentProperties, state) => {
  const value = documentProperties[node.attribs.name]

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
    textNode.data = escape(value)
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
      state.container.type === "layout")) {
    const article = siteData.articles.find(a => a.path == `articles/${articleName}.html`)

    if (article === undefined) return err(render(node))

    return doRenderEmbeddedArticle(article, siteData, state)
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
      state.container.type === "layout")) {
    const articles = filterArticles(siteData.articles, pattern, tag)
    sortArticles(articles, orderBy)
    return articles.map(article => doRenderEmbeddedArticle(article, siteData, state)).flat()
  }
  else {
    return err(render(node))
  }
}

const doRenderEmbeddedArticle = (article, siteData, state) => {
  const localState = getLocalState(state, article, undefined)

  const wrapper = getWrapper(siteData, article.path)
  const properties = getDocumentProperties(article, wrapper, undefined, siteData.properties)

  const articleContent =
    article.dom.children
      .map(child => renderNode(child, siteData, properties, localState))
      .flat()

  if (wrapper) {
    const localState2 = getLocalState(state, wrapper, articleContent, article.inserts)

    return wrapper.dom.children
      .map(child => renderNode(child, siteData, properties, localState2))
      .flat()
  }
  else {
    return articleContent
  }
}

const renderLink = (node, properties, siteData, state) => {
  const localState =
    mergeState(state, {container: node, targetPath: node.attribs.href, label: node.attribs.label})

  let children

  if (node.attribs.component !== undefined) {
    const component =
      siteData.components.find(c => c.path == `components/${node.attribs.component}.html`)

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

  if (node.attribs.href === href) {
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
    const articles = filterArticles(siteData.articles, pattern, tag)
    if (orderBy !== undefined) sortArticles(articles, orderBy)
    return articles.map(article => renderArticleLink(node, article, siteData, state)).flat()
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
    if (state.label != "") {
      const textNode = parseDocument("\n").children[0]
      textNode.data = escape(state.label)
      return textNode
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
    addSwitcherHook(newNode, newState)

  if (newNode.attribs["tg:rotator"] !== undefined && state.hookName === undefined)
    addRotatorHook(newNode, newState)

  if (state.hookName === "toggler") addTogglerSubhooks(newNode, documentProperties)
  else if (state.hookName === "switcher") addSwitcherSubhooks(newNode, documentProperties)
  else if (state.hookName === "rotator") addRotatorSubhooks(newNode, documentProperties)

  removeTgAttribs(newNode.attribs)

  newNode.children =
    node.children
      .map(child => renderNode(child, siteData, documentProperties, newState))
      .flat()

  return newNode
}

const convertAttribs = (attribs, documentProperties) => {
  Object.keys(attribs).forEach(key => {
    if (key === "class") return
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

// x-data:
//   f: Flag, a boolean value indicating the on/off state of the toggler

const addTogglerHook = (newNode, newState) => {
  newNode.attribs["x-data"] = `{ f: false }`
  newNode.attribs["x-on:click"] = `f = false`
  newNode.attribs["x-on:click.outside"] = `f = false`
  newState.hookName = "toggler"
}

// x-data:
//   i: Current index number of the switcher
//   s: Lower limit of index numbers
//   e: Upper limit of index numbers
//   v: Interval Id, the return value from `setInterval` function

const addSwitcherHook = (newNode, newState) => {
  const md = [...newNode.attribs["tg:switcher"].trim().match(/^(\d+)\.\.(\d+)$/)]

  if (md !== null) {
    const s = parseInt(md[1], 10)
    const e = parseInt(md[2], 10)

    if (s < e) {
      newState.hookName = "switcher"
      newNode.attribs["x-data"] = `{ i: ${s}, s: ${s}, e: ${e}, v: undefined }`

      if (newNode.attribs["tg:interval"] !== undefined) {
        const interval = parseInt(newNode.attribs["tg:interval"], 10)

        if (! Number.isNaN(interval)) {
          const innerScript = "if (i < e) i = i + 1; else clearInterval(v)"
          const script = `v = setInterval(() => { ${innerScript} }, ${interval});`
          newNode.attribs["x-init"] = script.trim().replaceAll(/\n/g, "")
        }
      }
    }
  }
}

// x-data:
//   i: Current index number of the rotator
//   s: Lower limit of index numbers
//   e: Upper limit of index numbers
//   v: Interval Id, the return value from `setInterval` function

const addRotatorHook = (newNode, newState) => {
  const md = [...newNode.attribs["tg:rotator"].trim().match(/^(\d+)\.\.(\d+)$/)]

  if (md !== null) {
    const s = parseInt(md[1], 10)
    const e = parseInt(md[2], 10)

    if (s < e) {
      newNode.attribs["x-data"] = `{ i: ${s}, s: ${s}, e: ${e}, v: undefined }`
      newState.hookName = "rotator"

      if (newNode.attribs["tg:interval"] !== undefined) {
        const interval = parseInt(newNode.attribs["tg:interval"], 10)

        if (! Number.isNaN(interval)) {
          const innerScript = "if (i < e) i = i + 1; else i = s"
          const script = `v = setInterval(() => { ${innerScript} }, ${interval});`
          newNode.attribs["x-init"] = script.trim().replaceAll(/\n/g, "")
        }
      }
    }
  }
}

const addTogglerSubhooks = (newNode) => {
  const enebledClass = (newNode.attribs["tg:enabled-class"] || "").replace(/'/, "\\'")
  const disabledClass = (newNode.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")

  if (newNode.attribs["tg:when"] === "on") {
    newNode.attribs["x-show"] = `f === true`
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

const addSwitcherSubhooks = (newNode, documentProperties) => {
  const enebledClass = (newNode.attribs["tg:enabled-class"] || "").replace(/'/, "\\'")
  const disabledClass = (newNode.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")
  const currentClass = (newNode.attribs["tg:current-class"] || "").replace(/'/, "\\'")
  const normalClass = (newNode.attribs["tg:normal-class"] || "").replace(/'/, "\\'")

  if (newNode.attribs["tg:when"] !== undefined) {
    const n = parseInt(newNode.attribs["tg:when"], documentProperties)
    if (!Number.isNaN(n)) newNode.attribs["x-show"] = `i === ${n}`
  }

  if (newNode.attribs["tg:first"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = s; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `i === s ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:prev"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = i > s ? i - 1 : i; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `i === s ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:next"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = i < e ? i + 1 : i; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `i === e ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:last"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = e; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `i === e ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:choose"] !== undefined) {
    const n = parseInt(newNode.attribs["tg:choose"], documentProperties)

    if (!Number.isNaN(n)) {
      newNode.attribs["x-on:click"] = `i = ${n}; clearInterval(v)`
      newNode.attribs["x-bind:class"] = `i == ${n} ? '${currentClass}' : '${normalClass}'`
    }
  }
}

const addRotatorSubhooks = (newNode, documentProperties) => {
  const enebledClass = (newNode.attribs["tg:enabled-class"] || "").replace(/'/, "\\'")
  const disabledClass = (newNode.attribs["tg:disabled-class"] || "").replace(/'/, "\\'")
  const currentClass = (newNode.attribs["tg:current-class"] || "").replace(/'/, "\\'")
  const normalClass = (newNode.attribs["tg:normal-class"] || "").replace(/'/, "\\'")

  if (newNode.attribs["tg:when"] !== undefined) {
    const n = parseInt(newNode.attribs["tg:when"], documentProperties)
    if (!Number.isNaN(n)) newNode.attribs["x-show"] = `i === ${n}`
  }

  if (newNode.attribs["tg:first"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = s; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `i === s ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:prev"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = i > s ? i - 1 : e; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `'${enebledClass}'`
  }

  if (newNode.attribs["tg:next"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = i < e ? i + 1 : s; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `'${enebledClass}'`
  }

  if (newNode.attribs["tg:last"] !== undefined) {
    newNode.attribs["x-on:click"] = "i = e; clearInterval(v)"
    newNode.attribs["x-bind:class"] = `i === e ? '${disabledClass}' : '${enebledClass}'`
  }

  if (newNode.attribs["tg:choose"] !== undefined) {
    const n = parseInt(newNode.attribs["tg:choose"], documentProperties)

    if (!Number.isNaN(n)) {
      newNode.attribs["x-on:click"] = `i = ${n}; clearInterval(v)`
      newNode.attribs["x-bind:class"] = `i == ${n} ? '${currentClass}' : '${normalClass}'`
    }
  }
}

const purgeAttribs = (attribs) => {
  const keys = Object.keys(attribs).filter(key => key.match(/^(on|x-|:|@)/))
  keys.forEach(key => delete attribs[key])
}

const removeTgAttribs = (attribs) => {
  const keys = Object.keys(attribs).filter(key => key.match(/^tg:/))
  keys.forEach(key => delete attribs[key])
}

const renderHead = (documentProperties) => {
  const head = parseDocument("<head></head>")

  const children = []

  children.push(parseDocument("<meta charset='utf-8'>").children[0])

  if (documentProperties["title"] !== undefined) {
    const title = documentProperties["title"]
    const doc = parseDocument(`<title>${title}</title>`)
    children.push(doc.children[0])
  }

  if (typeof documentProperties.meta === "object") {
    Object.keys(documentProperties.meta).forEach(name => {
      const content = documentProperties.meta[name]
      const doc = parseDocument(`<meta name="${name}" content="${content}">`)
      children.push(doc.children[0])
    })
  }

  if (typeof documentProperties["http-equiv"] === "object") {
    Object.keys(documentProperties["http-equiv"]).forEach(name => {
      const content = documentProperties["http-equiv"][name]
      const doc = parseDocument(`<meta http-equiv="${name}" content="${content}">`)
      children.push(doc.children[0])
    })
  }

  if (typeof documentProperties["meta-property"] === "object") {
    Object.keys(documentProperties["meta-property"]).forEach(name => {
      const content = documentProperties["meta-property"][name]

      if (typeof content !== "string") return

      const converted = content.replaceAll(/\$\{([^}]+)\}/g, (_, propName) => {
        const parts = propName.split(".")

        if (parts.length === 1) {
          const value = documentProperties[propName]

          if (typeof value === "string") {
            return value
          }
          else {
            return `\${${propName}}`
          }
        }
        else if (parts.length === 2) {
          const p1 = parts[0]
          const p2 = parts[2]

          if (typeof documentProperties[p1] === "object") {
            const value = documentProperties[p1][p2]

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

      const doc = parseDocument(`<meta property="${name}" content="${converted}">`)
      children.push(doc.children[0])
    })
  }

  if (typeof documentProperties["link"] === "object") {
    Object.keys(documentProperties["link"]).forEach(rel => {
      if (rel == "stylesheet") return
      const href = documentProperties["link"][rel]
      const doc = parseDocument(`<link rel="${rel}" href="${href}">`)
      children.push(doc.children[0])
    })
  }

  if (documentProperties["font-material-symbols"] === true) {
    const doc = parseDocument("<link rel='stylesheet' href='/css/material-symbols/index.css'>")
    children.push(doc.children[0])
  }

  children.push(parseDocument("<link rel='stylesheet' href='/css/tailwind.css'>").children[0])
  children.push(parseDocument("<script src='/js/alpine.min.js' defer></script>>").children[0])
  children.push(parseDocument("<script src='/reload/reload.js' defer></script>>").children[0])

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

  if (obj2.targetPath !== undefined) newState.targetPath = obj2.targetPath
  if (obj2.label !== undefined) newState.label = obj2.label
  if (obj2.container !== undefined) newState.container = obj2.container
  if (obj2.innerContent !== undefined) newState.innerContent = obj2.innerContent
  if (obj2.inserts !== undefined) newState.inserts = obj2.inserts
  if (obj2.hookName !== undefined) newState.hookName = obj2.hookName
  return newState
}

const err = (message) => {
  const escaped = escape(message)
  const div = "<span class='inline-block bg-error text-black m-1 py-1 px-2'>X</span>"
  const divNode = parseDocument(div).children[0]
  divNode.children[0].data = escaped
  return divNode
}

export { renderWebPage }
