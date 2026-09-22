<?php
declare(strict_types=1);

// Optional endpoint. All simulation routes remain browser-only and independent.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function abort_ai(int $status, string $message): never {
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}
function setting(string $name): string|false {
    $environment = getenv($name);
    if ($environment !== false) return $environment;
    static $private = null;
    if ($private === null) {
        // Shared hosting may not expose persistent env vars to PHP. This file is OUTSIDE DocumentRoot.
        $file = dirname(rtrim($_SERVER['DOCUMENT_ROOT'] ?? '', '/')) . '/macro-nation-ai-config.php';
        $private = is_file($file) ? require $file : [];
        if (!is_array($private)) $private = [];
    }
    return isset($private[$name]) && is_string($private[$name]) ? $private[$name] : false;
}
function enabled(string $name): bool { return setting($name) === 'true'; }
function bounded_string(mixed $v, int $length): string {
    if (!is_string($v) || trim($v) === '' || mb_strlen($v, 'UTF-8') > $length) abort_ai(400, 'Invalid text');
    return $v;
}
function bounded_number(mixed $v, float $limit = 1000000000): float {
    if (!is_int($v) && !is_float($v)) abort_ai(400, 'Invalid number');
    $n = (float)$v;
    if (!is_finite($n) || abs($n) > $limit) abort_ai(400, 'Invalid number');
    return $n;
}
function fields(mixed $v, array $names): array {
    if (!is_array($v) || array_is_list($v) || array_diff(array_keys($v), $names)) abort_ai(400, 'Invalid fields');
    return $v;
}
function list_value(mixed $v, int $limit): array {
    if (!is_array($v) || !array_is_list($v) || count($v) > $limit) abort_ai(400, 'Invalid list');
    return $v;
}
function facts(mixed $v): array {
    $v = fields($v, ['month', 'indicators', 'causes', 'recentEvents', 'policy']);
    $month = bounded_number($v['month'] ?? null, 10000);
    if ($month < 0 || floor($month) !== $month) abort_ai(400, 'Invalid month');
    $indicators = fields($v['indicators'] ?? null, ['realGdp','gdpGrowth','inflation','unemployment','policyRate','fx','fxChange','governmentDebtRatio','support']);
    foreach ($indicators as $value) bounded_number($value);
    $causes = list_value($v['causes'] ?? [], 18);
    foreach ($causes as $cause) {
        $cause = fields($cause, ['indicator','delta','source','contribution']);
        bounded_string($cause['indicator'] ?? null, 60);
        bounded_string($cause['source'] ?? null, 100);
        bounded_number($cause['delta'] ?? null);
        bounded_number($cause['contribution'] ?? null);
    }
    foreach (list_value($v['recentEvents'] ?? [], 3) as $event) bounded_string($event, 100);
    if (isset($v['policy'])) bounded_string($v['policy'], 160);
    return $v;
}
function validated_request(string $feature, mixed $data): array {
    if ($feature === 'freePolicy') {
        $data = fields($data, ['text']);
        bounded_string($data['text'] ?? null, 300);
    } elseif ($feature === 'advisors') {
        $data = fields($data, ['facts', 'experts']);
        facts($data['facts'] ?? null);
        $experts = list_value($data['experts'] ?? null, 3);
        if (count($experts) < 1) abort_ai(400, 'Select an expert');
        $ids = [];
        foreach ($experts as $expert) {
            $expert = fields($expert, ['id','role','values','tone','portraitAssetKey']);
            $id = bounded_string($expert['id'] ?? null, 64);
            if (in_array($id, $ids, true)) abort_ai(400, 'Duplicate expert');
            $ids[] = $id;
            foreach (['role','values','tone'] as $key) bounded_string($expert[$key] ?? null, 100);
            if (isset($expert['portraitAssetKey'])) bounded_string($expert['portraitAssetKey'], 80);
        }
    } elseif ($feature === 'news') {
        $data = fields($data, ['id', 'facts']);
        bounded_string($data['id'] ?? null, 80);
        facts($data['facts'] ?? null);
    } else {
        $data = fields($data, ['ending', 'milestones']);
        facts($data['ending'] ?? null);
        foreach (list_value($data['milestones'] ?? null, 18) as $milestone) {
            $milestone = fields($milestone, ['month', 'summary']);
            bounded_number($milestone['month'] ?? null, 10000);
            bounded_string($milestone['summary'] ?? null, 120);
        }
    }
    return $data;
}
function obj(array $properties): array {
    return ['type' => 'object', 'properties' => $properties, 'required' => array_keys($properties), 'additionalProperties' => false];
}
function str(): array { return ['type' => 'string']; }
function schema_for(string $feature): array {
    if ($feature === 'advisors') return obj(['advice' => ['type' => 'array', 'items' => obj([
        'expertId' => str(), 'conclusion' => str(), 'reason' => str(), 'caution' => str(),
    ])]]);
    if ($feature === 'freePolicy') {
        // Flat nullable fields keep Structured Outputs strict; normalize to the engine union afterward.
        $candidate = obj([
            'policyType' => ['type' => 'string', 'enum' => ['interestRate','taxPackage','publicWorks','tariff','fxIntervention']],
            'targetRate' => ['type' => ['number','null']],
            'incomeTaxDelta' => ['type' => ['number','null']],
            'corporateTaxDelta' => ['type' => ['number','null']],
            'consumptionTaxDelta' => ['type' => ['number','null']],
            'lowIncomeTransferGdpShare' => ['type' => ['number','null']],
            'durationMonths' => ['type' => ['integer','null']],
            'sector' => ['type' => ['string','null'], 'enum' => ['transport','energy','digital','education','disasterPrevention',null]],
            'industryId' => ['type' => ['string','null'], 'enum' => ['agricultureResources','manufacturing','construction','householdServices','financeRealEstate','energyLogistics',null]],
            'rateDelta' => ['type' => ['number','null']],
            'direction' => ['type' => ['string','null'], 'enum' => ['buyDomestic','sellDomestic',null]],
            'sizeGdpShare' => ['type' => ['number','null']],
        ]);
        return obj(['status' => ['type' => 'string', 'enum' => ['supported','unsupported']], 'explanation' => str(), 'candidate' => ['anyOf' => [$candidate, ['type' => 'null']]]]);
    }
    if ($feature === 'news') return obj([
        'headline' => str(), 'explanation' => str(), 'perspectives' => ['type' => 'array', 'items' => obj([
            'viewpoint' => ['type' => 'string', 'enum' => ['anchor','newspaper','citizen','business','social']], 'text' => str(),
        ])],
    ]);
    return obj(['title' => str(), 'narrative' => str()]);
}
function validate_result(string $feature, mixed $value, array $request): mixed {
    if (!is_array($value)) throw new RuntimeException('Invalid model JSON');
    if ($feature === 'advisors') {
        $list = $value['advice'] ?? null;
        if (!is_array($list) || count($list) !== count($request['experts'])) throw new RuntimeException('Advice count mismatch');
        $ids = array_column($request['experts'], 'id');
        foreach ($list as $item) {
            if (!is_array($item) || !in_array($item['expertId'] ?? null, $ids, true)) throw new RuntimeException('Unknown expert');
            $ids = array_values(array_diff($ids, [$item['expertId']]));
            foreach (['conclusion'=>160,'reason'=>240,'caution'=>160] as $key=>$max) if (!is_string($item[$key] ?? null) || mb_strlen($item[$key], 'UTF-8') > $max) throw new RuntimeException('Invalid advice');
        }
        return $list;
    }
    if ($feature === 'freePolicy') {
        if (!is_string($value['explanation'] ?? null) || mb_strlen($value['explanation'], 'UTF-8') > 220) throw new RuntimeException('Invalid policy explanation');
        if (($value['status'] ?? '') === 'unsupported' && ($value['candidate'] ?? null) === null) return ['status'=>'unsupported', 'explanation'=>$value['explanation'], 'candidate'=>null];
        $candidate = $value['candidate'] ?? null;
        $definitions = [
            'interestRate'=>['targetRate'],
            'taxPackage'=>['incomeTaxDelta','corporateTaxDelta','consumptionTaxDelta','lowIncomeTransferGdpShare','durationMonths'],
            'publicWorks'=>['sector','sizeGdpShare'],
            'tariff'=>['industryId','rateDelta','durationMonths'],
            'fxIntervention'=>['direction','sizeGdpShare'],
        ];
        $type = is_array($candidate) ? ($candidate['policyType'] ?? '') : '';
        if (($value['status'] ?? '') !== 'supported' || !isset($definitions[$type])) throw new RuntimeException('Unsupported policy');
        $normalized = ['policyType'=>$type];
        foreach ($definitions[$type] as $key) {
            if (!isset($candidate[$key])) throw new RuntimeException('Missing policy value');
            $normalized[$key] = $candidate[$key];
            if (in_array($key, ['sector','industryId','direction'], true)) {
                $enums = [
                    'sector'=>['transport','energy','digital','education','disasterPrevention'],
                    'industryId'=>['agricultureResources','manufacturing','construction','householdServices','financeRealEstate','energyLogistics'],
                    'direction'=>['buyDomestic','sellDomestic'],
                ];
                if (!in_array($candidate[$key], $enums[$key], true)) throw new RuntimeException('Invalid policy enum');
            } elseif ((!is_int($candidate[$key]) && !is_float($candidate[$key])) || !is_finite((float)$candidate[$key]) || abs((float)$candidate[$key]) > 120) throw new RuntimeException('Invalid policy number');
        }
        foreach ($candidate as $key=>$v) if (!in_array($key, $definitions[$type], true) && $key !== 'policyType' && $v !== null) throw new RuntimeException('Unexpected policy value');
        return ['status'=>'supported', 'explanation'=>$value['explanation'], 'candidate'=>$normalized];
    }
    if ($feature === 'news') {
        foreach (['headline'=>100,'explanation'=>400] as $key=>$max) if (!is_string($value[$key] ?? null) || mb_strlen($value[$key], 'UTF-8') > $max) throw new RuntimeException('Invalid news');
        if (!is_array($value['perspectives'] ?? null) || count($value['perspectives']) > 5) throw new RuntimeException('Invalid perspectives');
        foreach ($value['perspectives'] as $item) if (!in_array($item['viewpoint'] ?? null, ['anchor','newspaper','citizen','business','social'], true) || !is_string($item['text'] ?? null) || mb_strlen($item['text'], 'UTF-8') > 220) throw new RuntimeException('Invalid perspective');
        return $value;
    }
    if (!is_string($value['title'] ?? null) || mb_strlen($value['title'], 'UTF-8') > 100 || !is_string($value['narrative'] ?? null) || mb_strlen($value['narrative'], 'UTF-8') > 1500) throw new RuntimeException('Invalid history');
    return $value;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') abort_ai(405, 'POST required');
if (!enabled('AI_ENABLED')) abort_ai(503, 'AI disabled');
$feature = null;
$features = ['advisors'=>'AI_ADVISORS_ENABLED', 'freePolicy'=>'AI_FREE_POLICY_ENABLED', 'news'=>'AI_NEWS_ENABLED', 'history'=>'AI_NATION_HISTORY_ENABLED'];
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) abort_ai(413, 'Request too large');
$raw = file_get_contents('php://input', false, null, 0, 8193);
if (!is_string($raw) || strlen($raw) > 8192) abort_ai(413, 'Request too large');
$input = json_decode($raw, true, 12);
if (!is_array($input) || array_diff(array_keys($input), ['feature','data'])) abort_ai(400, 'Invalid request');
$feature = $input['feature'] ?? null;
if (!is_string($feature) || !isset($features[$feature]) || !enabled($features[$feature])) abort_ai(403, 'Feature disabled');
$data = validated_request($feature, $input['data'] ?? null);
$origin = $_SERVER['HTTP_ORIGIN'] ?? null;
if ($origin !== null) {
    $host = parse_url($origin, PHP_URL_HOST);
    $requestHost = explode(':', strtolower($_SERVER['HTTP_HOST'] ?? ''))[0];
    if (!is_string($host) || !hash_equals($requestHost, strtolower($host))) abort_ai(403, 'Origin mismatch');
}
$dir = setting('AI_DATA_DIR');
$public = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
if (!is_string($dir) || !is_dir($dir) || !is_writable($dir) || ($public !== false && str_starts_with(realpath($dir) . '/', $public . '/'))) abort_ai(503, 'AI storage unavailable');
$model = setting('OPENAI_MODEL');
$provider = setting('AI_PROVIDER') ?: 'mock';
$priceFile = __DIR__ . '/_private/prices.json';
$prices = json_decode((string)file_get_contents($priceFile), true);
if ($provider === 'openai' && (!is_string($model) || $model === '' || !isset($prices[$model]) || !setting('OPENAI_API_KEY'))) abort_ai(503, 'AI provider unavailable');
if (!in_array($provider, ['openai','mock'], true)) abort_ai(503, 'Unknown provider');

// Nonblocking global lock caps simultaneous requests to one and protects the counter/budget file.
$lock = fopen($dir . '/ai.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) abort_ai(429, 'AI busy');
$day = gmdate('Y-m-d');
$hour = gmdate('Y-m-d-H');
$ip = hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
$stateFile = $dir . '/limits-' . $day . '.json';
$limits = json_decode((string)@file_get_contents($stateFile), true);
if (!is_array($limits)) $limits = ['dayCount'=>0, 'cost'=>0, 'hours'=>[]];
$key = $hour . ':' . $ip . ':' . $feature;
$perHour = max(1, min(100, (int)(setting('AI_PER_IP_FEATURE_HOUR') ?: 5)));
$daily = max(1, min(10000, (int)(setting('AI_DAILY_REQUEST_LIMIT') ?: 100)));
$budget = max(0, (float)(setting('AI_DAILY_COST_USD') ?: 1));
if (($limits['hours'][$key] ?? 0) >= $perHour || $limits['dayCount'] >= $daily || $limits['cost'] >= $budget) abort_ai(429, 'AI usage limit reached');
$limits['hours'][$key] = ($limits['hours'][$key] ?? 0) + 1;
$limits['dayCount']++;
if (file_put_contents($stateFile, json_encode($limits), LOCK_EX) === false) abort_ai(503, 'AI usage storage unavailable');
$started = microtime(true);
$usage = [];
$cost = null;
$success = false;
$error = null;
try {
    if ($provider === 'mock') {
        $result = match ($feature) {
            'advisors' => array_map(static fn($x) => ['expertId'=>$x['id'], 'conclusion'=>'政策の効果を確認しましょう。', 'reason'=>'因果ログと指標を照合します。', 'caution'=>'副作用と時間差があります。'], $data['experts']),
            'freePolicy' => ['status'=>'unsupported', 'explanation'=>'Mockでは自由入力を既存政策画面で確認してください。', 'candidate'=>null],
            'news' => ['headline'=>'特別報道', 'explanation'=>'指標と因果ログを確認してください。', 'perspectives'=>[['viewpoint'=>'anchor','text'=>'引き続き動向を追います。']]],
            'history' => ['title'=>'国家運営の記録', 'narrative'=>'政策と出来事を振り返りましょう。'],
        };
    } else {
        $promptPath = __DIR__ . '/_private/prompts/' . $feature . '-v1.txt';
        $prompt = file_get_contents($promptPath);
        if ($prompt === false) throw new RuntimeException('Prompt unavailable');
        $payload = [
            'model'=>$model, 'store'=>false, 'reasoning'=>['effort'=>'none'],
            'max_output_tokens'=>match ($feature) { 'advisors'=>800, 'freePolicy'=>350, 'news'=>700, 'history'=>750 },
            'prompt_cache_key'=>'macro-nation-' . $feature . '-v1',
            'input'=>[['role'=>'system','content'=>$prompt], ['role'=>'user','content'=>json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]],
            'text'=>['format'=>['type'=>'json_schema','name'=>'macro_nation_' . $feature,'strict'=>true,'schema'=>schema_for($feature)]],
        ];
        $ch = curl_init('https://api.openai.com/v1/responses');
        curl_setopt_array($ch, [CURLOPT_POST=>true, CURLOPT_RETURNTRANSFER=>true, CURLOPT_HTTPHEADER=>[
            'Authorization: Bearer ' . setting('OPENAI_API_KEY'), 'Content-Type: application/json',
        ], CURLOPT_POSTFIELDS=>json_encode($payload, JSON_THROW_ON_ERROR), CURLOPT_CONNECTTIMEOUT=>3, CURLOPT_TIMEOUT=>10, CURLOPT_MAXREDIRS=>0]);
        $body = curl_exec($ch);
        $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if (!is_string($body) || $http < 200 || $http >= 300) throw new RuntimeException('Provider HTTP ' . $http);
        $response = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        $usage = $response['usage'] ?? [];
        $inputTokens = (int)($usage['input_tokens'] ?? 0);
        $cached = (int)($usage['input_tokens_details']['cached_tokens'] ?? 0);
        $written = (int)($usage['input_tokens_details']['cache_write_tokens'] ?? 0);
        $outputTokens = (int)($usage['output_tokens'] ?? 0);
        $p = $prices[$model];
        $cost = ((max(0, $inputTokens - $cached - $written) * $p['input'] + $cached * $p['cached_input'] + $written * $p['cache_write'] + $outputTokens * $p['output']) / 1000000);
        $limits['cost'] += $cost;
        if (file_put_contents($stateFile, json_encode($limits), LOCK_EX) === false) throw new RuntimeException('AI usage storage unavailable');
        if (($response['status'] ?? '') !== 'completed') throw new RuntimeException('Incomplete response');
        $parts = [];
        foreach ($response['output'] ?? [] as $item) if (($item['type'] ?? '') === 'message') foreach ($item['content'] ?? [] as $part) {
            if (($part['type'] ?? '') === 'output_text') $parts[] = $part['text'];
        }
        $result = validate_result($feature, json_decode(implode('', $parts), true, 24, JSON_THROW_ON_ERROR), $data);
    }
    $success = true;
    echo json_encode(['result'=>$result], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    $error = $e instanceof JsonException ? 'invalid_json' : 'provider_failure';
    http_response_code(503);
    echo json_encode(['error'=>'AI temporarily unavailable']);
} finally {
    $log = [
        'timestamp'=>gmdate('c'), 'feature'=>$feature, 'model'=>$provider === 'mock' ? 'mock' : $model,
        'input_tokens'=>$usage['input_tokens'] ?? 0,
        'cached_input_tokens'=>$usage['input_tokens_details']['cached_tokens'] ?? 0,
        'cache_write_tokens'=>$usage['input_tokens_details']['cache_write_tokens'] ?? 0,
        'output_tokens'=>$usage['output_tokens'] ?? 0, 'total_tokens'=>$usage['total_tokens'] ?? 0,
        'latency_ms'=>(int)((microtime(true)-$started)*1000), 'success'=>$success,
        'estimated_cost_usd'=>$cost, 'error'=>$error,
    ];
    file_put_contents($dir . '/usage-' . $day . '.jsonl', json_encode($log, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
    flock($lock, LOCK_UN);
    fclose($lock);
}
