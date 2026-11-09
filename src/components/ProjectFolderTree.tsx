import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { MolBioSidebarNodeIcon } from './MolBioIcons';
import { PROJECT_ROOT, type ExplorerFolder } from '../core/projectExplorer';

interface Props {
  folders: ExplorerFolder[];
  parent?: string;
  selected: string;
  expanded: Record<string, boolean>;
  colors: Record<string, string>;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, id: string) => void;
}

export function ProjectFolderTree(props: Props) {
  const { folders, parent = PROJECT_ROOT, selected, expanded, colors, counts, onSelect, onToggle, onContextMenu } = props;
  return <div className="tree-indent-1">
    {folders.filter((folder) => folder.parent === parent).map((folder) => {
      const hasChildren = folders.some((child) => child.parent === folder.id);
      const open = expanded[folder.id] ?? true;
      return <React.Fragment key={folder.id}>
        <button type="button"
          className={`source-folder-row ${selected === folder.id ? 'selected' : ''}`}
          aria-expanded={hasChildren ? open : undefined}
          aria-haspopup="menu"
          onClick={() => onSelect(folder.id)}
          onContextMenu={(event) => onContextMenu(event, folder.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' && hasChildren && !open) { event.preventDefault(); onToggle(folder.id); }
            if (event.key === 'ArrowLeft' && hasChildren && open) { event.preventDefault(); onToggle(folder.id); }
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault();
              onContextMenu(event, folder.id);
            }
          }}>
          {hasChildren ? <span className="tree-chevron-click" aria-hidden="true"
            onClick={(event) => { event.stopPropagation(); onToggle(folder.id); }}>
            {open ? <ChevronDown size={12} className="tree-chevron" /> : <ChevronRight size={12} className="tree-chevron" />}
          </span> : <span className="tree-leaf-spacer" aria-hidden="true" />}
          <MolBioSidebarNodeIcon nodeKey={folder.id} isOpen={selected === folder.id || (hasChildren && open)} accentColor={colors[folder.id]} size={14} />
          <span className="folder-label">{folder.label}</span>
          <span className="folder-count">{counts[folder.id] ?? 0}</span>
        </button>
        {hasChildren && open && <ProjectFolderTree {...props} parent={folder.id} />}
      </React.Fragment>;
    })}
  </div>;
}
