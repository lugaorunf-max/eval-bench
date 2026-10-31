import type { Metadata } from 'next';
import './styles.css';
import './design.css';
import './agents.css';
import './polish.css';
import './result-layout.css';
import './library.css';
import './unified.css';
import './facets.css';
import './editorial.css';
import './writing-workspace.css';
import './top-workspaces.css';
import './compact-workspaces.css';
import './navigation-hierarchy.css';
import './writing-compose.css';
import './sidebar-workspaces.css';
import './hotspots.css';
import './collection-controls.css';
import './media-workflow.css';
import './content-library.css';
import './article-workbench.css';
import './card-articles.css';
import './material-grid.css';

export const metadata: Metadata = { title: '测写 · 内容创作与案例实测', description: '从选题与案例实测，到整理素材和写作成稿。' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
