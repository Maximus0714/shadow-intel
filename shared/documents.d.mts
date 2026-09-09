export function analyzeLocalText(text: string): {
  doc_id: string;
  summary: string;
  entities: {text:string;type:string}[];
  triples: {subject:string;relation:string;object:string;evidence:string}[];
  resolution: {clusters:{canonical_label:string;type:string;members:string[];confidence:number}[];review_queue:{entity_a:string;entity_b:string;confidence:number;reason:string}[];method:string};
  classification: {method:string;sentences:number;characters:number;review_priority:string;confidence:number;matched_cues:string[];interpretation:string};
  warnings: string[];
};
