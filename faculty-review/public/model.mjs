export const VERSION=1;
export const LIMITS={objectives:30,assignments:20,text:40000,rubric:20000,objective:2000,body:180000,file:6*1024*1024};
export const ALIGNMENT=['Not yet reviewed','Not aligned','Slightly aligned','Moderately aligned','Mostly aligned','Fully aligned'];
export const RISK=['Not yet reviewed','Very Low','Low','Moderate','High','Very High'];
export const RESILIENCE=['Not yet reviewed','Very Resilient','Resilient','Somewhat Resilient','Vulnerable','Highly Vulnerable'];
export const AIAS=['Not set','No AI','AI-assisted idea generation and structuring','AI-assisted editing','AI task completion, human evaluation','Full AI'];
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=m=>{throw new Error(m)};
function str(v,name,max,min=0){if(typeof v!=='string'||v.length<min||v.length>max)fail(`${name} must contain ${min}–${max} characters.`);return v;}
export function validateInput(x){
 if(!x||typeof x!=='object')fail('The review input is missing.');
 str(x.courseTitle,'Course title',160,1);
 if(x.objectivesConfirmed!==true)fail('Confirm the official objective wording before continuing.');
 if(!Array.isArray(x.objectives)||!x.objectives.length||x.objectives.length>LIMITS.objectives)fail(`Add 1–${LIMITS.objectives} objectives.`);
 const ids=new Set();
 const objectives=x.objectives.map(o=>{str(o.id,'Objective ID',60,1);if(!/^[A-Za-z0-9_-]+$/.test(o.id))fail('Invalid objective ID.');str(o.text,'Objective text',LIMITS.objective,1);if(!o.text.trim()||ids.has(o.id))fail('Every objective needs unique identification and nonempty text.');ids.add(o.id);return {id:o.id,text:o.text};});
 const a=x.assignment;if(!a||typeof a!=='object')fail('Add an assignment.');
 str(a.id,'Assignment ID',60,1);if(!/^[A-Za-z0-9_-]+$/.test(a.id)||['__proto__','constructor','prototype'].includes(a.id))fail('Invalid assignment ID.');str(a.title,'Assignment title',180,1);str(a.module,'Module',80);str(a.text,'Assignment instructions',LIMITS.text,40);str(a.rubric,'Rubric',LIMITS.rubric);
 if(!a.title.trim()||!a.text.trim())fail('Add the assignment title and instructions.');
 const d=a.delivery;
 if(!d||!['unknown','take-home','supervised','live','mixed'].includes(d.setting))fail('Choose a delivery setting.');
 if(!['unknown','yes','no'].includes(d.ownData)||!['unknown','yes','no'].includes(d.processEvidence)||!['unknown','yes','no'].includes(d.oralExplanation))fail('Choose a response for each delivery question.');
 str(d.notes,'Delivery notes',2500);
 if(a.aiasLevel!==null&&(!Number.isInteger(a.aiasLevel)||a.aiasLevel<1||a.aiasLevel>5))fail('Choose an AI permission level or leave it unset.');
 return {courseTitle:x.courseTitle,objectivesConfirmed:true,objectives,assignment:{id:a.id,title:a.title,module:a.module,text:a.text,rubric:a.rubric,delivery:{setting:d.setting,ownData:d.ownData,processEvidence:d.processEvidence,oralExplanation:d.oralExplanation,notes:d.notes},aiasLevel:a.aiasLevel}};
}
export function deliveryText(d){return `Delivery setting: ${d.setting}\nStudent's own observations or data required: ${d.ownData}\nDrafts or process records required: ${d.processEvidence}\nLive oral explanation required: ${d.oralExplanation}\nAdditional delivery information: ${d.notes}`;}
const normalized=s=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
function evidenceList(list,input,warnings){
 if(!Array.isArray(list)||list.length>5)fail('The analysis returned invalid evidence.');
 const sources={assignment:input.assignment.text,rubric:input.assignment.rubric,delivery:deliveryText(input.assignment.delivery)};
 return list.filter(e=>{if(!e||!Object.hasOwn(sources,e.source)||typeof e.quote!=='string'||e.quote.length<8||e.quote.length>1200)fail('The analysis returned invalid evidence.');if(!normalized(sources[e.source]).includes(normalized(e.quote))){warnings.push('An evidence quotation did not match the supplied text and was removed.');return false;}return true;}).map(e=>({source:e.source,quote:e.quote}));
}
function score(n){if(n!==null&&(!Number.isInteger(n)||n<1||n>5))fail('The analysis returned a rating outside the 1–5 scale.');return n;}
export function validateAnalysis(raw,input){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.alignment)||raw.alignment.length!==input.objectives.length)fail('The analysis did not return one result for every objective. Please try again.');
 str(raw.summary,'Analysis summary',2500,1);str(raw.limits,'Analysis limitations',4000,1);
 const warnings=[],seen=new Set();
 const alignment=raw.alignment.map(r=>{
  if(!r||!input.objectives.some(o=>o.id===r.objectiveId)||seen.has(r.objectiveId))fail('The analysis changed or repeated an objective ID.');seen.add(r.objectiveId);
  str(r.reason,'Rating explanation',3000,1);str(r.improvement,'Suggested improvement',2000,1);
  let value=score(r.score),evidence=evidenceList(r.evidence,input,warnings),reason=r.reason;
  if(value!==null&&!evidence.length){value=null;reason='Not yet reviewed: the suggested rating did not include evidence that could be verified in the supplied text. '+reason;warnings.push(`Objective ${r.objectiveId} was left unreviewed because its evidence could not be verified.`);}
  return {objectiveId:r.objectiveId,score:value,reason,evidence,improvement:r.improvement,status:'Suggested rating: needs human review.',reviewed:false};
 });
 const ai=raw.ai;if(!ai)fail('The analysis did not return an AI vulnerability review.');
 str(ai.reason,'AI explanation',3000,1);str(ai.improvement,'AI improvement',2000,1);str(ai.assumptions,'Delivery assumptions',3000,1);
 let risk=score(ai.riskLevel),evidence=evidenceList(ai.evidence,input,warnings);if(risk!==null&&!evidence.length){risk=null;warnings.push('AI risk was left unreviewed because its evidence could not be verified.');}
 return {assignmentId:input.assignment.id,summary:raw.summary,limits:raw.limits,alignment:input.objectives.map(o=>alignment.find(r=>r.objectiveId===o.id)),ai:{riskLevel:risk,reason:ai.reason,improvement:ai.improvement,assumptions:ai.assumptions,evidence,reviewed:false,status:'Suggested rating: needs human review.'},warnings:[...new Set(warnings)],generatedAt:new Date().toISOString(),provider:'OpenAI',method:'Custom five-point alignment review; provisional ARMS-informed risk estimate. Not a formal Quality Matters review.'};
}
export function fingerprint(input){return JSON.stringify(validateInput(input));}
export function summaryStats(course,results){const rs=course.assignments.map(a=>results[a.id]).filter(Boolean);let strong=0,weak=0,unknown=0;for(const o of course.objectives){const values=rs.flatMap(r=>r.alignment.filter(p=>p.objectiveId===o.id&&p.score!==null).map(p=>p.score));if(!values.length)unknown++;else if(Math.max(...values)>=4)strong++;else weak++;}return{strong,weak,unknown,reviewed:rs.length,total:course.assignments.length,vulnerable:rs.filter(r=>r.ai.riskLevel>=4).length,riskReviewed:rs.filter(r=>r.ai.riskLevel!==null).length};}
export function validateManualEdit(edit){score(edit.score);str(edit.reason,'Faculty explanation',3000,8);str(edit.improvement,'Suggested improvement',2000,1);return edit;}
export function makeEmptyResult(input){return {assignmentId:input.assignment.id,summary:'Faculty review started without an automated analysis.',limits:'No automated review has been run.',alignment:input.objectives.map(o=>({objectiveId:o.id,score:null,reason:'Not yet reviewed.',evidence:[],improvement:'Identify required student work that demonstrates this objective.',reviewed:false,status:'Not yet reviewed'})),ai:{riskLevel:null,reason:'Not yet reviewed.',evidence:[],improvement:'Review delivery and required evidence of student thinking.',assumptions:'No automated estimate is available.',reviewed:false,status:'Not yet reviewed'},warnings:[],generatedAt:new Date().toISOString(),provider:'Faculty',method:'Custom five-point alignment review; provisional ARMS-informed risk estimate. Not a formal Quality Matters review.'};}
export function validateCourse(c){
 if(!c||c.version!==VERSION||!Array.isArray(c.assignments)||!c.assignments.length||c.assignments.length>LIMITS.assignments)fail('This is not a supported saved review.');
 const seen=new Set();for(const a of c.assignments){if(seen.has(a.id))fail('Saved review has repeated assignment IDs.');seen.add(a.id);validateInput({courseTitle:c.courseTitle,objectives:c.objectives,objectivesConfirmed:true,assignment:a});}
 return {version:VERSION,courseTitle:c.courseTitle,objectives:c.objectives.map(o=>({id:o.id,text:o.text})),objectivesConfirmed:!!c.objectivesConfirmed,assignments:c.assignments.map(a=>validateInput({courseTitle:c.courseTitle,objectives:c.objectives,objectivesConfirmed:true,assignment:a}).assignment)};
}
