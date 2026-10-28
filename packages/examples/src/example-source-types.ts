export type SourceLanguage = 'html' | 'javascript' | 'typescript' | 'css' | 'json';

export interface ExampleSourceFile {
  id: string;
  name: string;
  path: string;
  origin: string;
  language: SourceLanguage;
  url: string;
  lineCount: number;
}

export interface ExampleSourceManifest {
  files: ExampleSourceFile[];
  defaultFile: string;
}

export interface HighlightedExampleSource {
  text: string;
  html: string;
  language: SourceLanguage;
  lineCount: number;
}
