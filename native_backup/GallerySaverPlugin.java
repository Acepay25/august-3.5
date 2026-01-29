package com.august35.tradingapp;

import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * GallerySaver - Custom Capacitor plugin to save images to Android Gallery
 * Uses MediaStore API for Android 10+ and legacy file system for older versions
 */
@CapacitorPlugin(name = "GallerySaver")
public class GallerySaverPlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        String base64Data = call.getString("base64");
        String filename = call.getString("filename", "trade-card-" + System.currentTimeMillis() + ".png");
        
        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("No image data provided");
            return;
        }
        
        try {
            // Remove data URL prefix if present
            if (base64Data.contains(",")) {
                base64Data = base64Data.split(",")[1];
            }
            
            // Decode base64 to bytes
            byte[] imageBytes = Base64.decode(base64Data, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
            
            if (bitmap == null) {
                call.reject("Failed to decode image");
                return;
            }
            
            // Save to gallery
            Uri savedUri = saveToGallery(bitmap, filename);
            
            if (savedUri != null) {
                // Show system toast
                getActivity().runOnUiThread(() -> {
                    Toast.makeText(getContext(), "Saved to Gallery!", Toast.LENGTH_SHORT).show();
                });
                
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("uri", savedUri.toString());
                result.put("message", "Image saved to gallery");
                call.resolve(result);
            } else {
                call.reject("Failed to save image");
            }
            
        } catch (Exception e) {
            call.reject("Error saving image: " + e.getMessage());
        }
    }
    
    private Uri saveToGallery(Bitmap bitmap, String filename) {
        Context context = getContext();
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+ - Use MediaStore
            ContentResolver resolver = context.getContentResolver();
            ContentValues contentValues = new ContentValues();
            contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            contentValues.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
            contentValues.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/August");
            
            Uri imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues);
            
            if (imageUri != null) {
                try (OutputStream outputStream = resolver.openOutputStream(imageUri)) {
                    if (outputStream != null) {
                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream);
                        return imageUri;
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        } else {
            // Legacy - Save to Pictures folder
            File picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
            File augustDir = new File(picturesDir, "August");
            if (!augustDir.exists()) {
                augustDir.mkdirs();
            }
            
            File imageFile = new File(augustDir, filename);
            
            try (FileOutputStream fos = new FileOutputStream(imageFile)) {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos);
                
                // Notify gallery about the new image
                android.media.MediaScannerConnection.scanFile(
                    context,
                    new String[]{imageFile.getAbsolutePath()},
                    new String[]{"image/png"},
                    null
                );
                
                return Uri.fromFile(imageFile);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        
        return null;
    }
}
