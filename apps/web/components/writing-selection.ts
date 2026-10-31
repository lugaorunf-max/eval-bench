import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { WritingSelection } from '@/packages/contracts/editorial';

type Range = { from:number; to:number; pinned?:boolean };
export const writingSelectionKey = new PluginKey<Range|null>('writingSelectedPassage');

// Decorations belong to the current editing session, never to saved/exported prose.
export function writingSelectionPlugin(){return new Plugin<Range|null>({
    key:writingSelectionKey,
    state:{
      init:()=>null,
      apply(tr,previous,_old,next){
        const command=tr.getMeta(writingSelectionKey);
        if(command!==undefined)return command;
        if(tr.selectionSet&&tr.selection instanceof TextSelection&&!tr.selection.empty&&!tr.docChanged){
          const {from,to}=tr.selection;
          return next.doc.textBetween(from,to,'\n').trim()?{from,to}:previous;
        }
        if(tr.selectionSet&&tr.selection.empty&&!tr.docChanged&&!previous?.pinned)return null;
        if(previous&&tr.docChanged){
          const from=tr.mapping.map(previous.from,1),to=tr.mapping.map(previous.to,-1);
          return to>from&&next.doc.textBetween(from,to,'\n').trim()?{from,to,pinned:previous.pinned}:null;
        }
        return previous;
      }
    },
    props:{decorations(state){const range=writingSelectionKey.getState(state);return range?DecorationSet.create(state.doc,[Decoration.inline(range.from,range.to,{class:'wd-selected-passage','data-writing-selection':'true'})]):DecorationSet.empty;}}
  });}

export const WritingSelectionHighlight = Extension.create({name:'writingSelectedPassage',addProseMirrorPlugins:()=>[writingSelectionPlugin()]});

export function selectedWritingPassage(state:EditorState):WritingSelection|null {
  const range=writingSelectionKey.getState(state);
  return range?{from:range.from,to:range.to,text:state.doc.textBetween(range.from,range.to,'\n')}:null;
}
