import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CaseLibrary,type AlternateCaseLibrary} from '../apps/web/components/case-library';

const noop=()=>{};
const props={cases:[],selected:[],choose:noop,selectVisible:noop,open:noop,create:noop,favorite:noop,favoriteBusy:[]};
const actions=h('button',{'data-case-action':'create'},'新建案例');
const states=h('nav',{'aria-label':'案例状态'},...['可测试','需解析','回收站'].map(label=>h('button',{key:label},label)));
const alternate=(label:string):AlternateCaseLibrary=>({sidebar:h('div',null,'筛选'),query:'',onQuery:noop,count:0,content:h('p',null,label)});
const markup=(alt?:AlternateCaseLibrary,error?:string)=>renderToStaticMarkup(h(CaseLibrary,{...props,actions,extra:states,alternate:alt,error}));

test('case states use one toolbar, state row and content origin for populated, empty, loading and error views',()=>{
 const variants=[markup(),markup(alternate('读取中')),markup(alternate('没有需解析案例')),markup(alternate('回收站为空'),'读取失败')];
 const expected=['shell','toolbar','search','actions','states','tools','content'];
 for(const html of variants){assert.deepEqual([...html.matchAll(/data-case-slot="([^"]+)"/g)].map(m=>m[1]),expected);assert.equal((html.match(/aria-label="搜索案例"/g)||[]).length,1);assert.equal((html.match(/data-case-action="create"/g)||[]).length,1);assert.equal((html.match(/aria-label="案例状态"/g)||[]).length,1);assert.ok(html.indexOf('data-case-slot="states"')<html.indexOf('data-case-slot="content"'));}
 const toolbar=(html:string)=>html.match(/<header[^>]*data-case-slot="toolbar"[\s\S]*?<\/header>/)![0];
 assert.ok(variants.every(html=>toolbar(html)===toolbar(variants[0])),'changing state must not replace the toolbar structure or actions');
 assert.ok(variants[3].indexOf('role="alert"')>variants[3].indexOf('data-case-slot="states"'),'errors belong below fixed navigation');
});
