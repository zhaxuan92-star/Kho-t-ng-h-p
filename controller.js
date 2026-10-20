(() => {
"use strict";
const $ = id => document.getElementById(id);
const input=$("apk"), nameEl=$("filename"), checkBtn=$("start"), uploadBtn=$("translate");
const workerUrl=$("workerUrl"), status=$("status"), report=$("report");
const checkWorkerBtn=$("checkWorker"), workerState=$("workerState");
const uploadDetails=$("uploadDetails"), uploadState=$("uploadState");
const uploadProgress=$("uploadProgress"), uploadPercent=$("uploadPercent");
const setStatus=(message)=>{status.textContent=message;};
const diagnostic=$("controllerState");
function markDiagnostic(message){if(diagnostic)diagnostic.textContent=message;}
markDiagnostic("controller.js đã chạy ✓");
window.addEventListener("error",e=>{markDiagnostic("Lỗi JavaScript: "+(e.message||"không rõ"));setStatus("Lỗi JavaScript: "+(e.message||"không rõ")+" · xem trạng thái chẩn đoán.");});
window.addEventListener("unhandledrejection",e=>{const m=e.reason&&e.reason.message?e.reason.message:String(e.reason||"không rõ");markDiagnostic("Lỗi Promise: "+m);});
const baseUrl=()=>workerUrl.value.trim().replace(/\/+$/,"");
function showReport(value){report.textContent=typeof value==="string"?value:JSON.stringify(value,null,2);report.style.display="block";}
input.addEventListener("change",()=>{\n markDiagnostic("Sự kiện chọn tệp đã chạy ✓");
 const file=input.files&&input.files[0];
 report.style.display="none";
 if(!file){nameEl.textContent="Chưa chọn tệp";checkBtn.disabled=true;uploadBtn.disabled=true;setStatus("Chưa chọn APK.");return;}
 nameEl.textContent=file.name+" · "+(file.size/1048576).toFixed(2)+" MiB";
 const valid=file.name.toLowerCase().endsWith(".apk");
 checkBtn.disabled=!valid; uploadBtn.disabled=!valid;
 setStatus(valid?"Đã chọn tệp trên điện thoại; CHƯA tải lên máy chủ. Hãy bấm nút bạn muốn dùng.":"Tệp không có đuôi .apk. Hãy chọn lại.");
});
checkWorkerBtn.addEventListener("click",async()=>{
 const base=baseUrl();
 if(!base){workerState.textContent="Thiếu URL";setStatus("Nhập URL Render trước, ví dụ https://ten-dich-vu.onrender.com");return;}
 checkWorkerBtn.disabled=true;workerState.textContent="Đang kiểm tra…";setStatus("Đang kiểm tra kết nối máy chủ…");
 try{
  const r=await fetch(base+"/",{method:"GET"});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const d=await r.json();
  workerState.textContent=(d.ok?"Đang hoạt động":"Có phản hồi")+(d.version?" · "+d.version:"");
  setStatus("Đã kết nối máy chủ. Giới hạn khai báo: "+(d.limits&&d.limits.maxUploadMB?d.limits.maxUploadMB+" MiB":"chưa xác định")+". Chưa tải APK lên.");
  showReport(d);
 }catch(e){workerState.textContent="Lỗi kết nối";setStatus("Không kiểm tra được máy chủ: "+e.message+". Hãy kiểm tra URL, trạng thái Render và CORS.");}
 finally{checkWorkerBtn.disabled=false;}
});
uploadBtn.addEventListener("click",async()=>{\n markDiagnostic("Đã nhận lệnh bấm Việt hóa ✓; đang kiểm tra điều kiện…");
 const file=input.files&&input.files[0],base=baseUrl();
 if(!file){setStatus("Trước tiên hãy chọn tệp APK.");return;}
 if(!base){setStatus("Nhập địa chỉ worker Render trước khi tải APK lên.");workerUrl.focus();return;}
 if(!/^https:\/\/[^ ]+/i.test(base)){setStatus("URL worker phải bắt đầu bằng https://");return;}
 if(file.size>900*1048576){setStatus("Tệp vượt 900 MiB. Hãy chọn tệp nhỏ hơn.");return;}
 uploadBtn.disabled=true;checkBtn.disabled=true;uploadBtn.textContent="Đang gửi APK…";markDiagnostic("Đang mở yêu cầu POST đến Render…");
 uploadDetails.style.display="block";uploadProgress.value=0;uploadPercent.textContent="0%";
 uploadState.textContent="Đang khởi tạo tải lên…";setStatus("Đang tải APK lên máy chủ. Giữ trang này mở.");
 report.style.display="none";
 try{
  const data=await new Promise((resolve,reject)=>{
   const form=new FormData();form.append("file",file,file.name);
   const xhr=new XMLHttpRequest();xhr.open("POST",base+"/api/translate",true);xhr.timeout=30*60*1000;
   // Do not attach upload progress listeners to this cross-origin XHR.
   // Browsers may preflight such uploads with OPTIONS; a plain FormData POST
   // avoids that extra preflight. Show indeterminate upload status instead.
   uploadProgress.removeAttribute("value");uploadPercent.textContent="Đang gửi";uploadState.textContent="Đang tải lên (không hiển thị phần trăm)…";
   xhr.onload=()=>{markDiagnostic("Render đã phản hồi HTTP "+xhr.status+".");
    if(xhr.status<200||xhr.status>=300){
     const reader=new FileReader();reader.onload=()=>{let msg="Máy chủ trả HTTP "+xhr.status;try{const d=JSON.parse(reader.result);msg=d.detail||d.error||msg;}catch{}reject(new Error(msg));};reader.onerror=()=>reject(new Error("Máy chủ trả HTTP "+xhr.status));reader.readAsText(xhr.response);
     return;
    }
    const ct=xhr.getResponseHeader("content-type")||"";
    if(ct.includes("application/json")||ct.includes("text/plain")){const reader=new FileReader();reader.onload=()=>{const txt=String(reader.result||"");if(txt.trim().startsWith("{")){try{const d=JSON.parse(txt);if(d.detail||d.error){reject(new Error(d.detail||d.error));return;}}catch{}}resolve(xhr.response);};reader.readAsText(xhr.response);return;}
    resolve(xhr.response);
   };
   xhr.onerror=()=>{markDiagnostic("XHR lỗi mạng/CORS; trình duyệt không nhận được phản hồi.");reject(new Error("Lỗi mạng/CORS. Kiểm tra origin, kết nối hoặc chính sách trình duyệt."));};
   xhr.ontimeout=()=>reject(new Error("Quá thời gian chờ. Worker có thể đã ngủ, bị dừng hoặc xử lý quá lâu."));
   xhr.onabort=()=>reject(new Error("Yêu cầu đã bị hủy."));
   xhr.responseType="blob";xhr.send(form);
  });
  if(!data||data.size===0)throw new Error("Máy chủ trả về tệp rỗng.");
  const url=URL.createObjectURL(data),a=document.createElement("a");a.href=url;a.download="apk-vietsub-debug-signed.apk";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  uploadProgress.value=100;uploadPercent.textContent="Hoàn tất";uploadState.textContent="Máy chủ đã trả tệp đầu ra; trình duyệt đã yêu cầu tải xuống.";
  setStatus("Hoàn tất: đã nhận phản hồi đầu ra từ máy chủ. Kiểm tra thư mục Tải xuống.");
  showReport("Máy chủ đã trả về "+(data.size/1048576).toFixed(2)+" MiB. Lưu ý: worker hiện chỉ dịch thử bằng bảng thuật ngữ, chưa Việt hóa đầy đủ Unity/IL2CPP.");
 }catch(e){markDiagnostic("Luồng Việt hóa thất bại: "+e.message);uploadState.textContent="THẤT BẠI: "+e.message;setStatus("Không tải/xử lý được APK: "+e.message);showReport("LỖI TẢI APK\n"+e.message+"\n\nNếu đây là lỗi CORS, cần cấu hình worker cho phép origin của website. Nếu HTTP 5xx, mở Logs trên Render.");}
 finally{uploadBtn.disabled=false;checkBtn.disabled=false;uploadBtn.textContent="Tải lên máy chủ, dịch thử và đóng gói APK";}
});
checkBtn.addEventListener("click",async()=>{\n markDiagnostic("Đã nhận lệnh Kiểm tra tệp ✓");
 const file=input.files&&input.files[0];if(!file){setStatus("Hãy chọn APK trước.");return;}
 if(file.size>4*1048576){setStatus("Tệp lớn hơn 4 MiB nên không thể kiểm kê qua Vercel. Bấm “Tải lên máy chủ, dịch thử và đóng gói APK” để gửi sang Render.");return;}
 checkBtn.disabled=true;checkBtn.textContent="Đang kiểm tra…";setStatus("Đang gửi tệp nhỏ đến API kiểm kê Vercel…");report.style.display="none";
 try{
  const r=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/octet-stream","Content-Disposition":'attachment; filename="'+file.name.replace(/["\\]/g,"_")+'"'},body:file});
  let d;try{d=await r.json();}catch{throw new Error("API không trả về JSON hợp lệ.");}
  if(!r.ok)throw new Error(d.error||"HTTP "+r.status);
  showReport(d);setStatus("Kiểm kê thành công. Đây chỉ là phân tích tệp, chưa phải bản Việt hóa.");
 }catch(e){setStatus("Kiểm kê thất bại: "+e.message);showReport(e.message);}
 finally{checkBtn.disabled=false;checkBtn.textContent="Kiểm tra tệp";}
});
const po=$("previewOriginal"),pv=$("previewVietnamese"),prO=$("originalRender"),prV=$("vietnameseRender"),pf=$("previewFont"),pfLabel=$("fontSizeLabel"),pb=$("previewBold"),pn=$("previewNarrow"),ps=$("renderStatus");
function renderPreview(){
 prO.textContent=po.value;prV.textContent=pv.value;const size=pf.value+"px";prO.style.fontSize=size;prV.style.fontSize=size;pfLabel.textContent=size;
 prO.style.fontWeight=pb.checked?"700":"400";prV.style.fontWeight=pb.checked?"700":"400";
 const width=pn.checked?"180px":"100%";prO.style.width=width;prV.style.width=width;
 const overflow=prV.scrollWidth>prV.clientWidth+2;ps.textContent=(pv.value.length>po.value.length?"Bản dịch dài hơn bản gốc. ":"")+(overflow?"⚠️ Có thể tràn ngang; giảm cỡ chữ hoặc mở rộng khung.":"✓ Chưa phát hiện tràn ngang.")+" Độ dài: "+pv.value.length+" ký tự.";
}
[po,pv,pf,pb,pn].forEach(el=>el.addEventListener("input",renderPreview));
$("copyTranslation").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(pv.value);ps.textContent="Đã sao chép bản dịch.";}catch{pv.select();ps.textContent="Hãy sao chép thủ công phần văn bản đã chọn.";}});renderPreview();
})();