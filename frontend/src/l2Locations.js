// L2 (kabupaten / kota) names accepted as Origin / Destination when sales enter lanes manually.
// Spelled exactly as in the master rate data so lane lookups match.
const L2_TEXT = `
Kab. Aceh Barat
Kab. Aceh Barat Daya
Kab. Aceh Besar
Kab. Aceh Jaya
Kab. Aceh Selatan
Kab. Aceh Singkil
Kab. Aceh Tamiyang
Kab. Aceh Tengah
Kab. Aceh Tenggara
Kab. Aceh Timur
Kab. Aceh Utara
Kota Banda Aceh
Kab. Bener Meriah
Kab. Bireuen
Kab. Gayo Lues
Kota Langsa
Kota Lhokseumawe
Kab. Nagan Raya
Kab. Pidie
Kab. Pidie Jaya
Kota Sabang
Kab. Simeulue
Kota Subulussalam
Kab. Badung
Kab. Bangli
Kab. Buleleng
Kota Denpasar
Kab. Gianyar
Kab. Jembrana
Kab. Karangasem
Kab. Klungkung
Kab. Tabanan
Kota Cilegon
Kota Serang
Kota Tangerang
Kab. Lebak
Kab. Pandeglang
Kab. Serang
Kab. Tangerang
Kota Tangerang Selatan
Kota Bengkulu
Kab. Bengkulu Selatan
Kab. Bengkulu Tengah
Kab. Bengkulu Utara
Kab. Kaur
Kab. Kepahiang
Kab. Lebong
Kab. Muko Muko
Kab. Rejang Lebong
Kab. Seluma
Kota Jakarta Barat
Kota Jakarta Pusat
Kota Jakarta Selatan
Kota Jakarta Timur
Kota Jakarta Utara
Kab. Batanghari
Kab. Bungo
Kota Jambi
Kab. Kerinci
Kab. Merangin
Kab. Muaro Jambi
Kab. Sarolangun
Kota Sungai Penuh
Kab. Tanjung Jabung Barat
Kab. Tanjung Jabung Timur
Kab. Tebo
Kab. Bandung
Kab. Bandung Barat
Kota Banjar
Kab. Bekasi
Kab. Bogor
Kab. Ciamis
Kab. Pangandaran
Kab. Cianjur
Kota Cimahi
Kab. Cirebon
Kota Depok
Kab. Garut
Kab. Indramayu
Kab. Karawang
Kota Bandung
Kota Bekasi
Kota Bogor
Kota Cirebon
Kota Sukabumi
Kota Tasikmalaya
Kab. Kuningan
Kab. Majalengka
Kab. Purwakarta
Kab. Subang
Kab. Sukabumi
Kab. Sumedang
Kab. Tasikmalaya
Kab. Banjarnegara
Kab. Banyumas
Kab. Batang
Kab. Blora
Kab. Boyolali
Kab. Brebes
Kab. Cilacap
Kab. Demak
Kab. Grobogan
Kab. Jepara
Kab. Karanganyar
Kab. Kebumen
Kab. Kendal
Kab. Klaten
Kota Magelang
Kota Pekalongan
Kota Semarang
Kota Tegal
Kab. Kudus
Kab. Magelang
Kab. Pati
Kab. Pekalongan
Kab. Pemalang
Kab. Purbalingga
Kab. Purworejo
Kab. Rembang
Kota Salatiga
Kab. Semarang
Kab. Sragen
Kab. Sukoharjo
Kota Surakarta
Kab. Tegal
Kab. Temanggung
Kab. Wonogiri
Kab. Wonosobo
Kab. Bangkalan
Kab. Banyuwangi
Kota Batu
Kab. Blitar
Kab. Bojonegoro
Kab. Bondowoso
Kab. Gresik
Kab. Jember
Kab. Jombang
Kab. Kediri
Kota Blitar
Kota Kediri
Kota Madiun
Kota Malang
Kota Mojokerto
Kota Pasuruan
Kota Probolinggo
Kab. Lamongan
Kab. Lumajang
Kab. Madiun
Kab. Magetan
Kab. Malang
Kab. Mojokerto
Kab. Nganjuk
Kab. Ngawi
Kab. Pacitan
Kab. Pamekasan
Kab. Pasuruan
Kab. Ponorogo
Kab. Probolinggo
Kab. Sampang
Kab. Sidoarjo
Kab. Situbondo
Kab. Sumenep
Kota Surabaya
Kab. Trenggalek
Kab. Tuban
Kab. Tulungagung
Kab. Balangan
Kab. Banjar
Kota Banjarbaru
Kota Banjarmasin
Kab. Barito Kuala
Kab. Hulu Sungai Selatan
Kab. Hulu Sungai Tengah
Kab. Hulu Sungai Utara
Kab. Kota Baru
Kab. Tabalong
Kab. Tanah bumbu
Kab. Tanah Laut
Kab. Tapin
Kota Balikpapan
Kota Bontang
Kab. Kutai Barat
Kab. Mahakam Ulu
Kab. Kutai Kertanegara
Kab. Kutai Timur
Kab. Paser
Kab. Penajam Paser Utara
Kota Samarinda
Kota Batam
Kab. Karimun
Kab. Lingga
Kab. Natuna
Kota Bandar Lampung
Kab. Lampung Barat
Kab. Pesisir Barat
Kab. Lampung Selatan
Kab. Lampung Tengah
Kab. Lampung Timur
Kab. Lampung Utara
Kab. Mesuji
Kota Metro
Kab. Pesawaran
Kab. Pringsewu
Kab. Tanggamus
Kab. Tulang Bawang Barat
Kab. Tulang Bawang
Kab. Way Kanan
Kab. Bengkalis
Kota Dumai
Kab. Indragiri Hilir
Kab. Indragiri Hulu
Kab. Kampar
Kab. Kepulauan Meranti
Kab. Kuantan Singingi
Kota Pekanbaru
Kab. Pelalawan
Kab. Rokan Hilir
Kab. Rokan Hulu
Kab. Siak
Kab. Majene
Kab. Mamasa
Kab. Mamuju
Kab. Mamuju Tengah
Kab. Mamuju Utara
Kab. Polewali Mandar
Kab. Bantaeng
Kab. Barru
Kab. Bone
Kab. Bulukumba
Kab. Enrekang
Kab. Gowa
Kab. Jeneponto
Kab. Kepulauan Selayar
Kab. Luwu
Kab. Luwu Timur
Kab. Luwu Utara
Kota Makassar
Kab. Maros
Kab. Palopo
Kab. Pangkajene Kepulauan
Kab. Parepare
Kab. Pinrang
Kab. Sidenreng Rappang
Kab. Sinjai
Kab. Soppeng
Kab. Takalar
Kab. Tana Toraja
Kab. Toraja Utara
Kab. Wajo
Kab. Agam
Kota Bukittinggi
Kab. Solok
Kab. Dharmasraya
Kab. Kepulauan Mentawai
Kota Solok
Kab. Lima Puluh Kota
Kota Padang
Kota Padang Panjang
Kab. Padang Pariaman
Kota Pariaman
Kab. Pasaman
Kab. Pasaman Barat
Kota Payakumbuh
Kab. Pesisir Selatan
Kota Sawahlunto
Kab. Sijunjung
Kab. Solok Selatan
Kab. Tanah Datar
Kab. Banyuasin
Kab. Empat Lawang
Kab. Lahat
Kota Lubuk Linggau
Kab. Penukal Abab Lematang Ilir
Kab. Muara Enim
Kab. Musi Banyuasin
Kab. Musi Rawas
Kab. Musi Rawas Utara
Kab. Ogan Ilir
Kab. Ogan Komering Ilir
Kab. Ogan Komering Ulu
Kab. Ogan Komering Ulu Selatan
Kab. Ogan Komering Ulu Timur
Kota Pagar Alam
Kota Palembang
Kota Prabumulih
Kab. Asahan
Kab. Batu Bara
Kab. Dairi
Kab. Deli Serdang
Kota Gunungsitoli
Kab. Humbang Hasundutan
Kab. Karo
Kota Binjai
Kota Medan
Kota Tanjung Balai
Kab. Labuhan Batu
Kab. Labuhanbatu Selatan
Kab. Labuhanbatu Utara
Kab. Samosir
Kab. Langkat
Kab. Mandailing Natal
Kab. Nias
Kab. Nias Barat
Kab. Nias Selatan
Kab. Nias Utara
Kab. Padang Lawas
Kab. Padang Lawas Utara
Kota Padangsidimpuan
Kab. Pakpak Bharat
Kota Pematangsiantar
Kab. Serdang Bedagai
Kota Sibolga
Kab. Simalungun
Kab. Tapanuli Selatan
Kab. Tapanuli Tengah
Kab. Tapanuli Utara
Kota Tebing Tinggi
Kab. Toba Samosir
Kab. Bantul
Kab. Gunung Kidul
Kota Yogyakarta
Kab. Kulon Progo
Kab. Sleman
`;

export const L2_LOCATIONS = [...new Set(L2_TEXT.split("\n").map((l) => l.trim()).filter(Boolean))].sort((a, b) =>
  a.localeCompare(b)
);

const L2_BY_LOWER = new Map(L2_LOCATIONS.map((n) => [n.toLowerCase(), n]));

// Canonical spelling of a typed/pasted location, or null if it isn't in the L2 list.
export const canonicalL2 = (value) => L2_BY_LOWER.get(String(value || "").trim().toLowerCase().replace(/\s+/g, " ")) || null;

export const VEHICLE_TYPES = ["Wingbox", "CDD Long", "CDD Standard", "CDE Long", "CDE Standard", "Blindvan"];
