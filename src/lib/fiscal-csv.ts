const headers=[
  "productId","sku","name","internalCode","manufacturerCode","gtin","ncm","cest","origin",
  "cfopInState","cfopOutState","icmsCst","icmsCsosn","icmsRate","pisCst","pisRate",
  "cofinsCst","cofinsRate","notes"
] as const;

function safeCell(value:unknown){
  let text=String(value??"");
  if(/^[=+@-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}

export function downloadFiscalCsv(rows:Record<string,unknown>[]){
  const lines=[headers.join(";"),...rows.map(row=>headers.map(h=>safeCell(row[h])).join(";"))];
  const blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");
  a.href=url;a.download=`classificacao-fiscal-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
}

function parseLine(line:string){
  const cells:string[]=[];let current="";let quoted=false;
  for(let i=0;i<line.length;i++){const ch=line[i];
    if(ch==='"'&&quoted&&line[i+1]==='"'){current+='"';i++;continue}
    if(ch==='"'){quoted=!quoted;continue}
    if(ch===";"&&!quoted){cells.push(current);current="";continue}
    current+=ch;
  }
  cells.push(current);return cells;
}

export function parseFiscalCsv(text:string){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(line=>line.trim());
  if(lines.length<2)throw new Error("Planilha vazia");
  const fileHeaders=parseLine(lines[0]);const missing=headers.filter(h=>!fileHeaders.includes(h));
  if(missing.length)throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}`);
  return lines.slice(1).map(line=>{const cells=parseLine(line);const row:Record<string,string>={};
    fileHeaders.forEach((h,i)=>row[h]=cells[i]??"");return row;
  }).filter(row=>row.productId&&row.ncm);
}
