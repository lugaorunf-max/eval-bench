import { Schema, Slice, type Node as ProseNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import type { DocumentNode, WritingSelection } from '../contracts/editorial';
import { markdownDocument } from './writing-document';
import type {WritingImageMap} from './writing-web-media';

// Match the stored editor schema without loading a browser or creating an editor.
export const writingSchema=new Schema({nodes:{
  doc:{content:'block+'},text:{group:'inline'},
  paragraph:{group:'block',content:'inline*'},heading:{group:'block',content:'inline*',attrs:{level:{default:2}}},
  blockquote:{group:'block',content:'block+'},bulletList:{group:'block',content:'listItem+'},orderedList:{group:'block',content:'listItem+',attrs:{start:{default:1}}},listItem:{content:'paragraph block*'},
  codeBlock:{group:'block',content:'text*',marks:'',attrs:{language:{default:null}}},
  hardBreak:{group:'inline',inline:true},horizontalRule:{group:'block'},
  writingReference:{group:'block',atom:true,attrs:{referenceId:{default:''}}},writingMedia:{group:'block',atom:true,attrs:{fileId:{default:''},caption:{default:''}}}
},marks:{bold:{},italic:{},strike:{},underline:{},code:{},link:{attrs:{href:{},target:{default:'_blank'},rel:{default:'noopener noreferrer'},class:{default:null}}}}});

export function verifyWritingSelection(document:DocumentNode,selection:WritingSelection):ProseNode {
  const doc=writingSchema.nodeFromJSON(document);
  if(selection.from<0||selection.to<=selection.from||selection.to>doc.content.size||doc.textBetween(selection.from,selection.to,'\n')!==selection.text)throw Error('选中的文字已变化，请重新选择后发送');
  return doc;
}

export function reviseSelectedPassage(document:DocumentNode,selection:WritingSelection,markdown:string,images:WritingImageMap={}):DocumentNode {
  const doc=verifyWritingSelection(document,selection),replacement=markdownDocument(markdown,images);
  // Referenced evidence/media remain present even when a selection spans their positions.
  const embedded:DocumentNode[]=[];
  doc.nodesBetween(selection.from,selection.to,node=>{if(['writingReference','writingMedia'].includes(node.type.name)){embedded.push(node.toJSON());return false;}});
  if(embedded.length)replacement.content!.push(...embedded);
  const next=writingSchema.nodeFromJSON(replacement);
  return new Transform(doc).replaceRange(selection.from,selection.to,Slice.maxOpen(next.content)).doc.toJSON();
}
