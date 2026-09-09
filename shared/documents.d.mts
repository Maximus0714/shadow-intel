export function analyzeLocalText(text: string): {
  doc_id: string;
  summary: string;
  entities: {text:string;type:string}[];
  triples: {subject:string;relation:string;object:string;evidence:string}[];
  classification: {method:string;sentences:number;characters:number};
  warnings: string[];
};
