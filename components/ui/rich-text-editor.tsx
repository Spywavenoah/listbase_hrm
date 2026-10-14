'use client';

import * as React from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link,
  Pilcrow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function htmlIsEmpty(html: string): boolean {
  const text = (html || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' && !/<(img|hr)[^>]*>/i.test(html || '');
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
}: RichTextEditorProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = React.useState(() => htmlIsEmpty(value));

  React.useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    if (el.innerHTML !== (value || '')) el.innerHTML = value || '';
    setIsEmpty(htmlIsEmpty(value));
  }, [value]);

  const exec = (command: string, arg?: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, arg);
    onChange(el.innerHTML);
    setIsEmpty(htmlIsEmpty(el.innerHTML));
  };

  const insertLink = () => {
    const url = window.prompt('Enter link URL', 'https://');
    if (url === null) return;
    exec(url.trim() ? 'createLink' : 'unlink', url.trim() || undefined);
  };

  const clearFormatting = () => {
    exec('removeFormat');
    exec('formatBlock', 'p');
  };

  const toolbar = [
    {
      group: [
        { icon: Bold, title: 'Bold', onClick: () => exec('bold') },
        { icon: Italic, title: 'Italic', onClick: () => exec('italic') },
        { icon: Underline, title: 'Underline', onClick: () => exec('underline') },
        { icon: Strikethrough, title: 'Strikethrough', onClick: () => exec('strikeThrough') },
      ],
    },
    {
      group: [
        { icon: Heading1, title: 'Heading 1', onClick: () => exec('formatBlock', 'h1') },
        { icon: Heading2, title: 'Heading 2', onClick: () => exec('formatBlock', 'h2') },
        { icon: Heading3, title: 'Heading 3', onClick: () => exec('formatBlock', 'h3') },
      ],
    },
    {
      group: [
        { icon: List, title: 'Bullet list', onClick: () => exec('insertUnorderedList') },
        { icon: ListOrdered, title: 'Numbered list', onClick: () => exec('insertOrderedList') },
        { icon: Quote, title: 'Quote', onClick: () => exec('formatBlock', 'blockquote') },
      ],
    },
    {
      group: [
        { icon: Link, title: 'Insert link', onClick: insertLink },
        { icon: Pilcrow, title: 'Clear formatting', onClick: clearFormatting },
      ],
    },
  ];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1">
        {toolbar.map((section, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />}
            {section.group.map((btn) => (
              <Button
                key={btn.title}
                type="button"
                variant="ghost"
                size="icon"
                title={btn.title}
                disabled={disabled}
                className="h-7 w-7"
                onMouseDown={(e) => e.preventDefault()}
                onClick={btn.onClick}
              >
                <btn.icon className="h-3.5 w-3.5" />
              </Button>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div className="relative">
        {isEmpty && (
          <div className="pointer-events-none absolute inset-x-3 top-2.5 z-[1] text-sm text-muted-foreground">
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          spellCheck
          className={cn(
            'min-h-[160px] overflow-y-auto px-3 py-2 text-sm text-foreground outline-none',
            '[&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold',
            '[&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold',
            '[&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold',
            '[&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5',
            '[&_blockquote]:mb-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
            '[&_a]:text-primary [&_a]:underline'
          )}
          onInput={() => {
            const el = ref.current;
            if (!el) return;
            onChange(el.innerHTML);
            setIsEmpty(htmlIsEmpty(el.innerHTML));
          }}
        />
      </div>
    </div>
  );
}