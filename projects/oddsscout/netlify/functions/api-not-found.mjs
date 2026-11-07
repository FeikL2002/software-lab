import {json} from '../../server/common.mjs';
export default async function() {
  return json({error:'API route not found. Check the path and deploy the complete functions project.',code:'API_NOT_FOUND'},404);
}
