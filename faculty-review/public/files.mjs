import {LIMITS} from './model.mjs';
export const PDF_VERSION='6.3.289';
const MAX_XML=12*1024*1024;
export async function readBounded(stream,limit){const reader=stream.getReader();let size=0,parts=[];try{while(true){let {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('The expanded document is too large. Paste the relevant assignment text instead.');}parts.push(value);}}finally{reader.releaseLock();}const result=new Uint8Array(size);let pos=0;for(const part of parts){result.set(part,pos);pos+=part.length;}return result;}
export async function docxXml(buffer){
 const bytes=new Uint8Array(buffer),v=new DataView(buffer);if(bytes.length<22)throw new Error('This is not a readable Word document.');let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
 if(end<0)throw new Error('This is not a readable .docx file.');
 if(v.getUint16(end+4,true)||v.getUint16(end+6,true))throw new Error('Multipart Word files are not supported.');
 let count=v.getUint16(end+10,true),pos=v.getUint32(end+16,true);if(count>5000)throw new Error('This Word document has too many embedded files.');
 for(let n=0;n<count;n++){
  if(pos+46>bytes.length||v.getUint32(pos,true)!==0x02014b50)throw new Error('The Word document is damaged.');
  const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),compressed=v.getUint32(pos+20,true),expanded=v.getUint32(pos+24,true),namelen=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
  if(pos+46+namelen+extra+comment>bytes.length)throw new Error('The Word document is damaged.');
  const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+namelen));pos+=46+namelen+extra+comment;
  if(name!=='word/document.xml')continue;
  if(flags&1)throw new Error('Password-protected Word documents are not supported.');
  if(expanded>MAX_XML||compressed>LIMITS.file)throw new Error('This document is too large to extract safely. Paste the relevant text instead.');
  if(offset+30>bytes.length||v.getUint32(offset,true)!==0x04034b50)throw new Error('The Word document is damaged.');
  const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);if(start+compressed>bytes.length)throw new Error('The Word document is incomplete.');
  const payload=bytes.slice(start,start+compressed);let inflated;
  if(method===0)inflated=payload;else if(method===8){try{inflated=await readBounded(new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw')),MAX_XML);}catch(e){throw new Error('This Word document could not be expanded. Try a current browser or paste the text.');}}else throw new Error('This Word compression format is not supported.');
  if(inflated.length!==expanded)throw new Error('The Word document failed its size check.');return new TextDecoder().decode(inflated);
 }
 throw new Error('No main document text was found in this Word file.');
}
export function xmlText(xml){const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw new Error('The Word document text could not be read.');const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';return Array.from(doc.getElementsByTagNameNS(ns,'p')).map(p=>Array.from(p.getElementsByTagNameNS(ns,'t')).map(t=>t.textContent).join('')).join('\n');}
export async function extractFile(file){
 if(file.size>LIMITS.file)throw new Error('Choose a file smaller than 6 MB, or paste the assignment text.');
 const ext=file.name.split('.').pop().toLowerCase();let text='',warnings=[];
 if(['txt','md'].includes(ext))text=await file.text();
 else if(ext==='docx'){text=xmlText(await docxXml(await file.arrayBuffer()));warnings.push('Check numbering, tables, symbols, and any instructions inside images. Only the main document text is extracted; headers, comments, and images are not included.');}
 else if(ext==='pdf'){
  let lib;try{lib=await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_VERSION}/build/pdf.min.mjs`)}catch{throw new Error('The PDF reader could not load. Check your connection or paste the text.');}
  lib.GlobalWorkerOptions.workerSrc=`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_VERSION}/build/pdf.worker.min.mjs`;
  const loading=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,disableFontFace:true,useSystemFonts:false});let pdf;
  try{pdf=await loading.promise;if(pdf.numPages>60)throw new Error('Choose a PDF with 60 pages or fewer.');let pages=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);const {items}=await page.getTextContent();pages.push(items.map(i=>typeof i.str==='string'?i.str+(i.hasEOL?'\n':' '):'').join(''));page.cleanup();}text=pages.join('\n\n');}finally{await loading.destroy();}
  warnings.push('Check columns, tables, and symbols. PDF images and diagrams are not interpreted; scanned pages need text pasted manually.');
 }else throw new Error('Choose a .docx, .pdf, .txt, or .md file. Older .doc files must first be saved as .docx.');
 if(text.trim().length<20)throw new Error('Very little readable text was found. This may be a scanned document. Paste the instructions instead.');
 if(text.length>60000)throw new Error('The extracted text is too long. Use a shorter file or paste only the relevant material.');
 return {text,warnings};
}
