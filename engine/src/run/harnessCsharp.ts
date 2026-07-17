import type { Judge } from '../types.js';
import { CASE_SENTINEL } from './console.js';

export function buildCsharpProgram(code: string, entry: string, casesPath: string, judge?: Judge): string {
  // Student code may already declare Solution; harness is a separate static class with Main.
  const casesPathLit = JSON.stringify(casesPath);
  const judgeKind = judge?.kind ?? null;
  const judgeArgIndex = judge?.argIndex ?? 0;
  return `${code}

static class __StudentHarness {
  static void Main() {
    try {
      var casesJson = System.IO.File.ReadAllText(${casesPathLit});
      using var casesDoc = System.Text.Json.JsonDocument.Parse(casesJson);
      var methodName = ${JSON.stringify(entry)};
      string judgeKind = ${JSON.stringify(judgeKind)};
      var judgeArgIndex = ${judgeArgIndex};
      var solutionType = typeof(Solution);
      var method = solutionType.GetMethod(methodName,
        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.IgnoreCase)
        ?? solutionType.GetMethod(methodName);
      if (method == null) {
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { fatal = $"could not find method {methodName}" }));
        return;
      }
      var instance = Activator.CreateInstance(solutionType);
      var parameters = method.GetParameters();
      var results = new System.Collections.Generic.List<object>();
      var caseIndex = 0;
      foreach (var caseEl in casesDoc.RootElement.EnumerateArray()) {
        Console.WriteLine($"${CASE_SENTINEL}{caseIndex}__");
        Console.Out.Flush();
        caseIndex++;
        try {
          var args = new object[parameters.Length];
          for (var i = 0; i < parameters.Length; i++) {
            var raw = caseEl[i];
            var pType = parameters[i].ParameterType;
            args[i] = System.Text.Json.JsonSerializer.Deserialize(raw.GetRawText(), pType);
          }
          var ret = method.Invoke(instance, args);
          object got = ret;
          if (judgeKind == "in-place") {
            got = args[judgeArgIndex];
          } else if (judgeKind == "k-prefix") {
            var arr = args[judgeArgIndex] as System.Array;
            if (arr == null) {
              results.Add(new { got = (object)null, error = "k-prefix arg is not an array" });
              continue;
            }
            if (ret is not int k || k < 0 || k > arr.Length) {
              results.Add(new { got = (object)null, error = $"k out of range: {ret}" });
              continue;
            }
            var prefix = new object[k];
            for (var i = 0; i < k; i++) prefix[i] = arr.GetValue(i);
            got = new { k, prefix };
          }
          results.Add(new { got, error = (string)null });
        } catch (Exception e) {
          var msg = e is System.Reflection.TargetInvocationException tie && tie.InnerException != null
            ? tie.InnerException.Message
            : e.Message;
          results.Add(new { got = (object)null, error = msg });
        }
      }
      Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { results }));
    } catch (Exception e) {
      Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { fatal = e.Message }));
    }
  }
}
`;
}
