-- book.lua — EPUB Maker structural filter.
--   * Replaces horizontal rules (scene breaks: "* * *") with a themed ornament.
--   * Adds a drop-cap to the first paragraph of each chapter (when enabled).
-- Both behaviours are driven by document metadata:
--   scene_ornament : string glyph(s) to render between scenes
--   dropcap        : "true" to enable drop caps on chapters

local function has_class(el, name)
  for _, c in ipairs(el.classes) do
    if c == name then return true end
  end
  return false
end

local QUOTES = {
  ['"'] = true,
  ["'"] = true,
  ["\u{201C}"] = true, -- “
  ["\u{201D}"] = true, -- ”
  ["\u{2018}"] = true, -- ‘
  ["\u{2019}"] = true, -- ’
  ["\u{00AB}"] = true, -- «
}

local POLISH_SHORT = {
  a = true, i = true, o = true, u = true, w = true, z = true,
  A = true, I = true, O = true, U = true, W = true, Z = true,
}

-- Polish typography does not leave one-letter conjunctions and prepositions at
-- the end of a line. Replace only the following space, keeping source Markdown
-- untouched and letting every output target receive the same composition.
local function polish_hanging_words(inlines)
  local out = {}
  local i = 1
  while i <= #inlines do
    local current = inlines[i]
    local next_inline = inlines[i + 1]
    table.insert(out, current)
    if current.t == "Str" and POLISH_SHORT[current.text] and next_inline and
       (next_inline.t == "Space" or next_inline.t == "SoftBreak") then
      table.insert(out, pandoc.Str("\u{00A0}"))
      i = i + 2
    else
      i = i + 1
    end
  end
  return out
end

-- Split a string into (leading quote marks, first letter, rest).
local function split_initial(s)
  local quotes, n = "", utf8.len(s) or 0
  local i = 1
  while i <= n do
    local a = utf8.offset(s, i)
    local b = utf8.offset(s, i + 1)
    local ch = b and s:sub(a, b - 1) or s:sub(a)
    if QUOTES[ch] then
      quotes = quotes .. ch
      i = i + 1
    else
      break
    end
  end
  if i > n then return quotes, "", "" end
  local a = utf8.offset(s, i)
  local b = utf8.offset(s, i + 1)
  local letter = b and s:sub(a, b - 1) or s:sub(a)
  local rest = b and s:sub(b) or ""
  return quotes, letter, rest
end

local function cap_span(text)
  return pandoc.Span({ pandoc.Str(text) }, pandoc.Attr("", { "dropcap" }))
end

local function splice(content, i, replacement)
  local new = {}
  for j = 1, #content do
    if j == i then
      for _, r in ipairs(replacement) do table.insert(new, r) end
    else
      table.insert(new, content[j])
    end
  end
  return pandoc.Para(new)
end

-- Wrap the first letter of a paragraph in a drop-cap span. Handles paragraphs
-- that open with dialogue: the opening quote rides along with the initial, the
-- traditional "quote + dropped capital" treatment, instead of being skipped.
local function dropcapify(para)
  local content = para.content
  for i, inl in ipairs(content) do
    if inl.t == "Str" and #inl.text > 0 then
      local quotes, letter, rest = split_initial(inl.text)
      if letter == "" then return para end
      local repl = { cap_span(quotes .. letter) }
      if rest ~= "" then table.insert(repl, pandoc.Str(rest)) end
      return splice(content, i, repl)
    elseif inl.t == "Quoted" then
      -- Pandoc parsed the opening dialogue as a quote node. Flatten the leading
      -- quote into characters so the drop cap can include it.
      local open = (inl.quotetype == "SingleQuote") and "\u{2018}" or "\u{201C}"
      local close = (inl.quotetype == "SingleQuote") and "\u{2019}" or "\u{201D}"
      local inner = inl.content
      local fidx, letter, rest
      for k, x in ipairs(inner) do
        if x.t == "Str" and #x.text > 0 then
          local _, l, r = split_initial(x.text)
          if l == "" then return para end
          fidx, letter, rest = k, l, r
          break
        elseif x.t ~= "Space" and x.t ~= "SoftBreak" then
          return para
        end
      end
      if not letter then return para end
      local repl = { cap_span(open .. letter) }
      if rest ~= "" then table.insert(repl, pandoc.Str(rest)) end
      for k = fidx + 1, #inner do table.insert(repl, inner[k]) end
      table.insert(repl, pandoc.Str(close))
      return splice(content, i, repl)
    elseif inl.t ~= "Space" and inl.t ~= "SoftBreak" then
      -- first meaningful inline isn't text or a quote (e.g. emphasis); leave it
      return para
    end
  end
  return para
end

-- Earlier Folio builds imported office-suite visual line endings as Markdown
-- hard breaks. In ordinary justified prose those become <br> and force a short
-- line to stretch across the full measure. Repair existing manuscripts at
-- render time without rewriting their source. Deliberate verse/chat blocks are
-- nested containers and therefore do not pass through this top-level path.
local function reflow_prose(para)
  for i, inl in ipairs(para.content) do
    if inl.t == "LineBreak" then para.content[i] = pandoc.SoftBreak() end
  end
  return para
end

-- Text-message / chat blocks: wrap each line in a bubble, alternating sides by
-- sender (the first sender becomes the right-aligned "me").
local CHAT = { text = true, message = true, sms = true, chat = true }

local function is_chat(div)
  for _, c in ipairs(div.classes) do
    if CHAT[c] then return true end
  end
  return false
end

local function sender_of(para)
  for _, inl in ipairs(para.content) do
    if inl.t == "Strong" then return pandoc.utils.stringify(inl) end
    if inl.t ~= "Space" and inl.t ~= "SoftBreak" then return nil end
  end
  return nil
end

function Div(div)
  if not is_chat(div) then return nil end
  local first
  local out = {}
  for _, blk in ipairs(div.content) do
    if blk.t == "Para" or blk.t == "Plain" then
      local s = sender_of(blk)
      local side = "them"
      if s then
        if not first then first = s end
        if s == first then side = "me" end
      end
      table.insert(out, pandoc.Div({ blk }, pandoc.Attr("", { "msg", side })))
    else
      table.insert(out, blk)
    end
  end
  div.content = out
  return div
end

function Pandoc(doc)
  local ornament = "* * *"
  local dropcap = false
  if doc.meta.scene_ornament then
    ornament = pandoc.utils.stringify(doc.meta.scene_ornament)
  end
  if doc.meta.dropcap then
    dropcap = pandoc.utils.stringify(doc.meta.dropcap) == "true"
  end
  local lang = doc.meta.lang and pandoc.utils.stringify(doc.meta.lang) or ""
  if lang:match("^pl") then
    doc = doc:walk({ Inlines = polish_hanging_words })
  end

  local out = {}
  local awaiting = false
  local reflow = false
  for _, b in ipairs(doc.blocks) do
    if b.t == "Header" and b.level == 1 then
      awaiting = dropcap and has_class(b, "chapter")
      reflow = has_class(b, "chapter") or has_class(b, "backmatter")
      table.insert(out, b)
    elseif b.t == "HorizontalRule" then
      table.insert(
        out,
        pandoc.RawBlock("html", '<p class="scene-break" role="separator">' .. ornament .. "</p>")
      )
    elseif b.t == "Para" and awaiting then
      awaiting = false
      if reflow then b = reflow_prose(b) end
      table.insert(out, dropcapify(b))
    else
      if b.t == "Para" and reflow then b = reflow_prose(b) end
      if b.t == "Para" or b.t == "Plain" then awaiting = false end
      table.insert(out, b)
    end
  end
  return pandoc.Pandoc(out, doc.meta)
end
