param(
	[Parameter(Mandatory = $true)]
	[string]$Version,
	[Parameter(Mandatory = $true)]
	[string]$CommitMessage,
	[Parameter(Mandatory = $true)]
	[string[]]$Changes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Update-JsonVersion {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Path
	)

	if ($Path -like '*package-lock.json') {
		$json = Get-Content -Path $Path -Raw | ConvertFrom-Json -AsHashtable
		$json.version = $Version
		if ($json.ContainsKey('packages') -and $json.packages.ContainsKey('')) {
			$json.packages[''].version = $Version
		}
		$updated = $json | ConvertTo-Json -Depth 100
		Set-Content -Path $Path -Value $updated -Encoding utf8
		return
	}

	$json = Get-Content -Path $Path -Raw | ConvertFrom-Json
	$json.version = $Version
	$updated = $json | ConvertTo-Json -Depth 100
	Set-Content -Path $Path -Value $updated -Encoding utf8
}

Update-JsonVersion -Path '.\extension.json'
Update-JsonVersion -Path '.\package.json'
Update-JsonVersion -Path '.\package-lock.json'

$changeLines = for ($i = 0; $i -lt $Changes.Length; $i++) {
	"{0}. {1}" -f ($i + 1), $Changes[$i]
}

$newSectionLines = @(
	"# $Version",
	'',
	'## 变更',
	''
) + $changeLines + @('')

$newSection = $newSectionLines -join "`n"

$originalChangelog = ''
if (Test-Path '.\CHANGELOG.md') {
	$originalChangelog = Get-Content -Path '.\CHANGELOG.md' -Raw
}

Set-Content -Path '.\CHANGELOG.md' -Value ($newSection + $originalChangelog) -Encoding utf8

npm run build
git add -A
git commit -m $CommitMessage --no-verify
