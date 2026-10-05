// Generates synthetic "lease" DOCX files with numbered clauses and paired tracked
// changes (w:del + w:ins) on every third paragraph. No real content.
//   node scripts/make-lease.mjs            -> public/lease-25.docx, lease-100.docx, lease-300.docx
//   node scripts/make-lease.mjs 1200       -> public/lease-1200p.docx (1,200 paragraphs)
import { mkdir, writeFile } from "node:fs/promises"
import JSZip from "jszip"

const WORDS = ("the tenant shall landlord premises covenant rent term lease clause " +
  "schedule pay keep repair insure assign underlet notice reasonable consent").split(" ")
let seed = 1
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const sentence = (n) => {
  const s = Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(" ")
  return s[0].toUpperCase() + s.slice(1) + "."
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const run = (text, tag = "w:t") => `<w:r><${tag} xml:space="preserve">${esc(text)}</${tag}></w:r>`

function documentXml(paragraphs) {
  let id = 1000
  const body = []
  for (let i = 0; i < paragraphs; i++) {
    const text = `${Math.floor(i / 12) + 1}.${(i % 12) + 1} ` + [12, 12, 12].map(sentence).join(" ")
    if (i % 3 === 0) {
      const replaced = text.replace(/tenant/g, "Tenant").replace(/landlord/g, "Landlord")
      body.push(
        `<w:p><w:del w:id="${id++}" w:author="Reviewer" w:date="2026-09-30T10:00:00Z">${run(text, "w:delText")}</w:del>` +
          `<w:ins w:id="${id++}" w:author="Reviewer" w:date="2026-09-30T10:00:00Z">${run(replaced)}</w:ins></w:p>`,
      )
    } else {
      body.push(`<w:p>${run(text)}</w:p>`)
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` +
    body.join("") +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  )
}

async function writeDocx(path, paragraphs) {
  const zip = new JSZip()
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file("word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)
  zip.file("word/document.xml", documentXml(paragraphs))
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))
  console.log(`${path}: ${paragraphs} paragraphs, ${Math.ceil(paragraphs / 3)} tracked replacements`)
}

await mkdir("public", { recursive: true })
const custom = process.argv[2]
if (custom) await writeDocx(`public/lease-${custom}p.docx`, Number(custom))
else for (const [pages, paras] of [[25, 300], [100, 1200], [300, 3600]]) await writeDocx(`public/lease-${pages}.docx`, paras)
