using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("TokenTracker")]
[assembly: AssemblyProduct("TokenTracker")]
[assembly: AssemblyDescription("Codex desktop token usage tracker")]
[assembly: AssemblyVersion("0.4.1.0")]
[assembly: AssemblyFileVersion("0.4.1.0")]

public sealed class PayloadFile
{
    public string path { get; set; }
    public string sha256 { get; set; }
}

internal static class Bundle
{
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    private static Stream Resource(string name)
    {
        Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Codexracker." + name);
        if (stream == null) throw new InvalidDataException("Missing bundled resource");
        return stream;
    }
    private static string Text(string name)
    {
        using (var reader = new StreamReader(Resource(name), Encoding.UTF8)) return reader.ReadToEnd();
    }
    private static string Hash(Stream stream)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    private static string SafePath(string root, string relative)
    {
        string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string target = Path.GetFullPath(Path.Combine(prefix, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (Path.IsPathRooted(relative) || relative.Contains(":") || !target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Invalid bundled path");
        return target;
    }
    private static void CheckDirectory(string directory)
    {
        var current = new DirectoryInfo(directory);
        while (current != null && current.Exists)
        {
            if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Redirected application directory");
            current = current.Parent;
        }
    }
    private static bool Verify(string root, List<PayloadFile> files)
    {
        if (!Directory.Exists(root)) return false;
        CheckDirectory(root);
        foreach (var item in files)
        {
            string target = SafePath(root, item.path);
            if (!File.Exists(target)) return false;
            CheckDirectory(Path.GetDirectoryName(target));
            if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0) return false;
            using (var input = File.OpenRead(target)) if (Hash(input) != item.sha256) return false;
        }
        return true;
    }
    internal static string Prepare(string programRoot)
    {
        string expected = Text("Hash").Trim();
        if (expected.Length != 64) throw new InvalidDataException("Invalid bundle fingerprint");
        using (var stream = Resource("Payload")) if (Hash(stream) != expected) throw new InvalidDataException("Bundle fingerprint mismatch");
        var files = Json.Deserialize<List<PayloadFile>>(Text("Manifest"));
        var known = new Dictionary<string, PayloadFile>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in files) known.Add(file.path.Replace('\\', '/'), file);
        Directory.CreateDirectory(programRoot);
        CheckDirectory(programRoot);
        string directoryName = expected.Substring(0, 24);
        string destination = SafePath(programRoot, directoryName);
        if (Verify(destination, files)) return destination;
        string staging = SafePath(programRoot, ".staging-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        using (var input = Resource("Payload"))
        using (var zip = new ZipArchive(input, ZipArchiveMode.Read))
        {
            int extracted = 0;
            foreach (var entry in zip.Entries)
            {
                string relative = entry.FullName.Replace('\\', '/');
                string target = SafePath(staging, relative);
                if (relative.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                if (!known.ContainsKey(relative)) throw new InvalidDataException("Unexpected bundled file");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var source = entry.Open())
                using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) source.CopyTo(output);
                extracted++;
            }
            if (extracted != files.Count) throw new InvalidDataException("Incomplete bundle");
        }
        if (!Verify(staging, files)) throw new InvalidDataException("Extracted bundle mismatch");
        if (Directory.Exists(destination))
        {
            // Preserve an altered cache instead of overwriting unknown local files.
            Directory.Move(destination, SafePath(programRoot, directoryName + ".preserved-" + Guid.NewGuid().ToString("N")));
        }
        Directory.Move(staging, destination);
        return destination;
    }
    internal static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
            else { result.Append('\\', slashes); result.Append(character); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }
    internal static Dictionary<string, object> Run(string program, string dataRoot, string action, Action<string> progress, bool isolatedPath)
    {
        var start = new ProcessStartInfo {
            FileName = Path.Combine(program, "node.exe"),
            Arguments = Quote(Path.Combine(program, "app", "launcher", "worker.mjs")) + " " + action + " " + Quote(dataRoot),
            WorkingDirectory = Path.Combine(program, "app"), UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        foreach (string key in new[] { "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE" }) start.EnvironmentVariables.Remove(key);
        if (isolatedPath)
        {
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            start.EnvironmentVariables["PATH"] = Path.Combine(windows, "System32") + ";" + Path.Combine(windows, "System32", "WindowsPowerShell", "v1.0");
        }
        Dictionary<string, object> final = null;
        using (var process = new Process { StartInfo = start })
        {
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) {
                if (string.IsNullOrWhiteSpace(args.Data)) return;
                try
                {
                    var item = Json.Deserialize<Dictionary<string, object>>(args.Data);
                    if (item.ContainsKey("message")) progress(Convert.ToString(item["message"]));
                    if (item.ContainsKey("type") && Convert.ToString(item["type"]) == "result") final = item;
                }
                catch (ArgumentException) { }
            };
            process.ErrorDataReceived += delegate { /* Do not persist raw process errors. */ };
            process.Start();
            process.BeginOutputReadLine(); process.BeginErrorReadLine(); process.WaitForExit();
            if (final == null) throw new IOException("Worker did not return a result");
            final["exitCode"] = process.ExitCode;
            return final;
        }
    }
}

internal sealed class LauncherWindow : Form
{
    private readonly Label status = new Label();
    private readonly Label elapsed = new Label();
    private readonly ProgressBar progress = new ProgressBar();
    private readonly List<Button> actions = new List<Button>();
    private readonly string root;
    private bool busy;
    internal LauncherWindow(string rootDirectory, bool previewOnly)
    {
        root = rootDirectory;
        Text = "TokenTracker";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        ClientSize = new Size(580, 330); MinimumSize = new Size(596, 369);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Microsoft JhengHei UI", 10);
        BackColor = Color.FromArgb(245, 247, 251);
        var title = new Label { Text = "TokenTracker · 讓每一點額度都有去處", Location = new Point(24, 22), AutoSize = true, Font = new Font(Font.FontFamily, 18, FontStyle.Bold) };
        var help = new Label { Text = "首次準備需複製完整 Codex，請預留約 3 GB 空間。\n請先退出原 Codex App；啟動器會保留既有用量與設定。", Location = new Point(24, 70), Size = new Size(530, 50) };
        status.Location = new Point(24, 134); status.Size = new Size(530, 62); status.Text = "正在準備…";
        progress.Location = new Point(24, 201); progress.Size = new Size(530, 8); progress.Style = ProgressBarStyle.Marquee;
        elapsed.Location = new Point(24, 214); elapsed.Size = new Size(530, 25); elapsed.ForeColor = Color.DimGray;
        var buttons = new FlowLayoutPanel { Location = new Point(24, 253), Size = new Size(535, 45), WrapContents = false };
        AddAction(buttons, "啟動 Codex", delegate { BeginAction("launch"); });
        AddAction(buttons, "檢查更新", delegate { BeginAction("sync"); });
        AddAction(buttons, "回復上一版", delegate { BeginAction("rollback"); });
        AddAction(buttons, "開啟資料夾", delegate {
            Directory.CreateDirectory(Path.Combine(root, "data"));
            Process.Start(new ProcessStartInfo { FileName = Path.Combine(root, "data"), UseShellExecute = true });
        });
        Controls.AddRange(new Control[] { title, help, status, progress, elapsed, buttons });
        Shown += delegate { if (!previewOnly) BeginAction("launch"); };
        FormClosing += delegate(object sender, FormClosingEventArgs args) {
            if (busy) { args.Cancel = true; elapsed.Text = "正在處理檔案，完成後即可關閉此視窗。"; }
        };
    }
    private void AddAction(FlowLayoutPanel panel, string text, Action click)
    {
        var button = new Button { Text = text, Width = 126, Height = 36, Margin = new Padding(0, 0, 8, 0) };
        button.Click += delegate { click(); }; panel.Controls.Add(button); actions.Add(button);
    }
    internal void RenderPreview(string destination)
    {
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-32000, -32000);
        ShowInTaskbar = false;
        Show();
        Application.DoEvents();
        using (var bitmap = new Bitmap(Width, Height))
        {
            DrawToBitmap(bitmap, new Rectangle(0, 0, Width, Height));
            bitmap.Save(destination, System.Drawing.Imaging.ImageFormat.Png);
        }
        Hide();
    }
    private async void BeginAction(string action)
    {
        if (busy) return;
        busy = true; foreach (var button in actions) button.Enabled = false;
        progress.Visible = true; status.Text = "正在驗證內含程式與執行環境…";
        var watch = Stopwatch.StartNew();
        var timer = new System.Windows.Forms.Timer { Interval = 1000 };
        timer.Tick += delegate { elapsed.Text = "已執行 " + (int)watch.Elapsed.TotalSeconds + " 秒"; };
        timer.Start();
        try
        {
            string program = await Task.Run(() => Bundle.Prepare(Path.Combine(root, "program")));
            var result = await Task.Run(() => Bundle.Run(program, Path.Combine(root, "data"), action, message => {
                BeginInvoke(new Action(() => status.Text = message));
            }, false));
            status.Text = Convert.ToString(result["message"]);
        }
        catch (Exception)
        {
            status.Text = "啟動未完成，既有資料已保留。請確認磁碟空間、官方 Codex 安裝與資料目錄存取權限，再重試。";
        }
        finally
        {
            timer.Stop(); timer.Dispose(); progress.Visible = false;
            elapsed.Text = "資料位置：" + Path.Combine(root, "data");
            busy = false; foreach (var button in actions) button.Enabled = true;
        }
    }
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--preview")
        {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new LauncherWindow(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Codexracker"), true))
                window.RenderPreview(Path.GetFullPath(args[1]));
            return 0;
        }
        if (args.Length == 3 && args[0] == "--smoke-test")
        {
            int exitCode = 1;
            object result;
            try
            {
                string root = Path.GetFullPath(args[1]);
                string program = Bundle.Prepare(Path.Combine(root, "program"));
                var worker = Bundle.Run(program, Path.Combine(root, "data"), "diagnose", delegate { }, true);
                exitCode = Convert.ToInt32(worker["exitCode"]);
                result = new { result = exitCode == 0 ? "passed" : "failed", selfContained = true,
                    systemNodeRequired = false, modelRequestsSent = false, appLaunched = false, worker = worker };
            }
            catch (Exception error) { result = new { result = "failed", category = error.GetType().Name }; }
            File.WriteAllText(Path.GetFullPath(args[2]), Bundle.Json.Serialize(result), new UTF8Encoding(false));
            return exitCode;
        }
        bool created;
        using (var mutex = new Mutex(true, "Local\\CodexrackerLauncher", out created))
        {
            if (!created) { MessageBox.Show("TokenTracker 啟動器已開啟，請使用既有視窗。", "TokenTracker"); return 0; }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Codexracker");
            Application.Run(new LauncherWindow(root, false));
            mutex.ReleaseMutex();
        }
        return 0;
    }
}
