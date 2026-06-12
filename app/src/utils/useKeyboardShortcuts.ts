import { useEffect } from 'react';
import { message } from 'antd';
import { useAppStore } from '../store/appStore';

function isInputTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  const role = (e.target as HTMLElement)?.getAttribute('role');
  const ce = (e.target as HTMLElement)?.isContentEditable;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    role === 'textbox' || role === 'combobox' || !!ce;
}

const isMac = navigator.platform.toUpperCase().includes('MAC');
function isMod(e: KeyboardEvent) { return isMac ? e.metaKey : e.ctrlKey; }

export function useKeyboardShortcuts() {
  const {
    connected, activeTab, setActiveTab,
    undoHistory, performUndo, setHistoryDrawerOpen,
    selectedEntry, copyEntryToClipboard, clipboardEntry,
  } = useAppStore();

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (isMod(e) && !e.shiftKey && !e.altKey && connected) {
        if (e.key === '1') { e.preventDefault(); setActiveTab('browser'); return; }
        if (e.key === '2') { e.preventDefault(); setActiveTab('search');  return; }
        if (e.key === '3') { e.preventDefault(); setActiveTab('schema');  return; }
      }
      if (isInputTarget(e)) return;
      if (isMod(e) && !e.shiftKey && e.key === 'z' && connected) {
        e.preventDefault();
        const latest = undoHistory[0];
        if (!latest) { message.info('Nothing to undo'); return; }
        try {
          await performUndo(latest.id);
          message.success('Undid: ' + latest.description);
        } catch (err) { message.error('Undo failed: ' + err); }
        return;
      }
      if (isMod(e) && !e.shiftKey && e.key === 'h' && connected) {
        e.preventDefault();
        setHistoryDrawerOpen(true);
        return;
      }
      if (isMod(e) && !e.shiftKey && e.key === 'c' && connected && selectedEntry) {
        e.preventDefault();
        copyEntryToClipboard(selectedEntry);
        message.success('Entry copied to clipboard');
        return;
      }
      if (isMod(e) && !e.shiftKey && e.key === 'v' && connected && clipboardEntry) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('paste-entry'));
        return;
      }
      if (e.key === '?' && !isMod(e)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('show-shortcuts'));
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connected, activeTab, undoHistory, performUndo, setActiveTab, setHistoryDrawerOpen,
      selectedEntry, copyEntryToClipboard, clipboardEntry]);
}
