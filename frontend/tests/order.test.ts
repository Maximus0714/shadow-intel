import assert from "node:assert/strict";
import { formatInfluence, orderEntities } from "../src/lib/data/entityOrder";
const nodes = [
  {id:"A",name:"A",label:"Person",role:"leader",community_id:10,influence_score:.7},
  {id:"B",name:"B",label:"Person",role:"member",community_id:2,influence_score:.1},
  {id:"C",name:"C",label:"Person",role:"bridge",community_id:0,influence_score:0},
  {id:"Z",name:"Z",label:"Vehicle"},
];
const ids = (field:Parameters<typeof orderEntities>[1], direction: "asc"|"desc") => orderEntities(nodes,field,direction).map(n=>n.id).join("");
assert.equal(ids("role","asc"),"BCAZ");
assert.equal(ids("role","desc"),"ACBZ");
assert.equal(ids("community","asc"),"CBAZ");
assert.equal(ids("community","desc"),"ABCZ");
assert.equal(ids("influence","asc"),"CBAZ");
assert.equal(ids("influence","desc"),"ABCZ");
assert.equal(nodes[0].id,"A");
assert.equal(formatInfluence(.1274), "12.7%");
assert.equal(formatInfluence(0), "0.0%");
assert.equal(formatInfluence(undefined), "N/A");
console.log("Entity ordering: semantic roles, numeric communities, zero scores and missing values passed.");
