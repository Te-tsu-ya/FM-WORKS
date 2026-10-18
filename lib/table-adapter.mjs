// Request-scoped table adapter. It never opens Google Sheets or a network URL.
export class SqlTable {
 constructor(name,headers,rows=[]){this.name=name;this.rows=[headers.slice(),...structuredClone(rows)];this.maxRows=Math.max(1000,this.rows.length);this.columns=headers.length;}
 getName(){return this.name;}getSheetId(){return this.name;}getLastRow(){return this.rows.length;}
 getLastColumn(){return this.columns;}getMaxColumns(){return this.columns;}getMaxRows(){return this.maxRows;}
 appendRow(row){this.rows.push(row.slice());return this;}
 deleteRows(at,n){if(at<2)throw Error('見出しは削除できません。');this.rows.splice(at-1,n);return this;}
 deleteRow(at){return this.deleteRows(at,1);}insertRowsAfter(_at,n){this.maxRows+=n;return this;}
 insertColumnsAfter(_at,n){this.columns+=n;return this;}setFrozenRows(){return this;}
 getDataRange(){return this.getRange(1,1,this.rows.length,this.columns);}
 getRangeList(refs){return {getRanges:()=>refs.map(ref=>this.getRange(ref))};}
 getRange(start,col,height=1,width=1){
  if(typeof start==='string'){
   const match=/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(start);if(!match)throw Error('不正なセル範囲');
   const number=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
   col=number(match[1]);start=Number(match[2]);width=number(match[3]||match[1])-col+1;height=Number(match[4]||match[2])-start+1;
  }
  if(start<1||col<1||height<1||width<1||col+width-1>this.columns)throw Error('不正なテーブル範囲');
  const table=this;
  const range={
   getRow:()=>start,
   getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>table.rows[start+i-1]?.[col+j-1]??'')),
   getDisplayValues(){return this.getValues().map(r=>r.map(v=>String(v??'')));},
   getValue(){return this.getValues()[0][0];},getDisplayValue(){return this.getDisplayValues()[0][0];},
   setValues(values){
    if(values.length!==height||values.some(r=>r.length!==width))throw Error('テーブルの列数が一致しません。');
    values.forEach((row,i)=>{table.rows[start+i-1]??=[];row.forEach((value,j)=>{table.rows[start+i-1][col+j-1]=value;});});return this;
   },
   setValue(value){return this.setValues([[value]]);},
   clearContent(){return this.setValues(Array.from({length:height},()=>Array(width).fill('')));},
   createTextFinder(value){
    let regex=false,entire=false,matchCase=false;
    return {useRegularExpression(v){regex=v;return this;},matchEntireCell(v){entire=v;return this;},matchCase(v){matchCase=v;return this;},
     findAll(){const result=[];const re=regex?new RegExp(value,matchCase?'':'i'):null;
      for(let i=start-1;i<Math.min(table.rows.length,start-1+height);i++)for(let j=col-1;j<col-1+width;j++){
       const text=String(table.rows[i]?.[j]??'');const a=matchCase?text:text.toLowerCase(),b=matchCase?String(value):String(value).toLowerCase();
       if(re?re.test(text):entire?a===b:a.includes(b))result.push({getRow:()=>i+1});
      }return result;
     },findNext(){return this.findAll()[0]||null;}
    };
   }
  };
  for(const key of ['setNumberFormat','setFontWeight','setBackground','setFontColor','setHorizontalAlignment','setVerticalAlignment','setWrap','setBorder'])range[key]=()=>range;
  return range;
 }
}
