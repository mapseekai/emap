import { AffineTransform } from '../../../../src/domain/geo/transform';
import type { GpuRenderer } from '../../../../src/integrations/luma/gpu-renderer';
import type { Rect } from '../../../../src/integrations/luma/types';

/** Cache the completed base map, not the edit overlay. Original handles and preview
 * segments are drawn afresh through luma every frame, including while a Worker
 * is rebuilding a complex polygon. No blocking pixel readbacks on pointermove.
 */
export class EditorBackdrop {
  private image:ImageBitmap|null=null;
  private bounds:Rect=[0,0,1,1];
  private key='';
  private pending='';
  private failed='';
  private epoch=0;
  private disposed=false;
  readonly stats={captures:0,overlayFrames:0,baseFrames:0,snapshotBytes:0};
  constructor(private gpu:GpuRenderer,private canvas:HTMLCanvasElement,private invalidate:()=>void){}
  draw(key:string,view:AffineTransform,width:number,height:number,ready:boolean,
    base:(overlay?:()=>void)=>number,overlay:()=>void):number {
    if(this.disposed)return 0;
    if(this.image&&(key===this.key||!ready)){
      const start=performance.now();
      if(this.gpu.begin(view)){try{this.gpu.drawImage(this.image,this.bounds,1,false,undefined,true);overlay();}finally{this.gpu.end();}}
      this.stats.overlayFrames++;return performance.now()-start;
    }
    // Keep normal rendering if a browser cannot capture this source.
    if(!ready||this.pending===key||this.failed===key)return base(overlay);
    const epoch=++this.epoch;this.pending=key;
    const a=view.unproject(0,height),b=view.unproject(width,0),bounds:Rect=[a[0],a[1],b[0],b[1]];
    const ms=base();this.stats.baseFrames++;
    let captured:ImageBitmap|null=null,abandoned=false;
    let capture:Promise<ImageBitmap>;
    try {capture=createImageBitmap(this.canvas,{premultiplyAlpha:'none',colorSpaceConversion:'none'});}catch(error){capture=Promise.reject(error);}
    const image=capture.then(bitmap=>{if(abandoned)bitmap.close();else captured=bitmap;return bitmap;});
    void Promise.all([image,this.gpu.waitForIdle()]).then(([bitmap])=>{
      if(this.disposed||epoch!==this.epoch){bitmap.close();return;}
      this.drop();this.image=bitmap;this.bounds=bounds;this.key=key;this.pending='';
      this.stats.snapshotBytes=bitmap.width*bitmap.height*4;this.stats.captures++;this.invalidate();
    }).catch(()=>{
      abandoned=true;captured?.close();
      if(epoch===this.epoch&&!this.disposed){this.pending='';this.failed=key;this.invalidate();}
    });
    // Capture the base before drawing the overlay, so old handles never leave ghosts.
    return ms+base(overlay);
  }
  private drop():void {
    if(this.image){this.gpu.forgetImage(this.image);this.image.close();this.image=null;}
    this.stats.snapshotBytes=0;
  }
  clear():void {this.epoch++;this.pending=this.key=this.failed='';this.drop();}
  dispose():void {this.clear();this.disposed=true;}
}
